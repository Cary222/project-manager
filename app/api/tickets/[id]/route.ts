import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import {
  assigneeUserSelect,
  loadUsersByIds,
  mapAssigneeUsers,
  normalizeAssigneeIds,
  replaceTicketAssignees,
} from "@/entities/ticket/lib/ticket-assignees";
import { requireRoot, requireSession } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { syncTicketCounterAfterDelete } from "@/entities/ticket/lib/ticket-counter";
import { ModerationAction } from "@prisma/client";
import { syncTicketSearchDocument } from "@/shared/lib/search";

async function enrichAssigneeHistory(
  history: {
    id: string;
    assigneeIds: string[];
    createdAt: Date;
    changedBy: {
      id: string;
      name: string | null;
      email: string;
      role: string;
    };
  }[]
) {
  const allIds = normalizeAssigneeIds(history.flatMap((item) => item.assigneeIds));
  const users = await loadUsersByIds(allIds);
  return history.map((item) => ({
    ...item,
    assignees: mapAssigneeUsers(users, item.assigneeIds),
  }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);
    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        project: {
          include: {
            responsibilities: {
              orderBy: { kind: "asc" },
              include: {
                modules: {
                  orderBy: { name: "asc" },
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        creator: {
          select: { id: true },
        },
        assignees: {
          include: {
            user: { select: assigneeUserSelect },
          },
        },
        module: {
          include: {
            responsibility: true,
          },
        },
        commits: {
          orderBy: { committedAt: "desc" },
        },
        pushSources: {
          include: {
            sourceTicket: {
              select: { id: true, ticketNo: true, title: true },
            },
          },
        },
        bugSources: {
          include: {
            programTicket: {
              select: { id: true, ticketNo: true, title: true },
            },
          },
        },
        assigneeHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            changedBy: { select: assigneeUserSelect },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            changedBy: { select: assigneeUserSelect },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const assigneeHistory = await enrichAssigneeHistory(ticket.assigneeHistory);

    return NextResponse.json({
      ticket: {
        ...ticket,
        creatorId: ticket.creator.id,
        assignees: ticket.assignees.map((item) => item.user),
        assigneeHistory,
        pushSources: ticket.pushSources,
        bugSources: ticket.bugSources,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const ticketNo = Number(id);

    // 获取单子信息用于审计日志
    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: { id: true, ticketNo: true, title: true },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM pm."DesignProgramBinding"
        WHERE "sourceTicketId" = ${ticket.id}
           OR "targetTicketId" = ${ticket.id}
      `;

      await tx.$executeRaw`
        DELETE FROM pm."BugProgramBinding"
        WHERE "bugTicketId" = ${ticket.id}
           OR "programTicketId" = ${ticket.id}
      `;

      await tx.ticket.delete({
        where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      });
    });

    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: "TICKET",
        sourceId: ticket.id,
      },
    });

    await syncTicketCounterAfterDelete();

    // 记录审计日志
    await createModerationLog({
      action: ModerationAction.DELETE_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `删除单子 #${ticket.ticketNo}: ${ticket.title}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: { assignees: { select: { userId: true } } },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isAssignee = ticket.assignees.some(a => a.userId === session.user.id);
    const isRoot = session.user.role === "ROOT";
    if (!isAssignee && !isRoot) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json()) as { title?: string; description?: string };
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        title: body.title?.trim() || undefined,
        description: body.description !== undefined ? (body.description.trim() || null) : undefined,
      },
    });
    await syncTicketSearchDocument(ticket.id);

    await createModerationLog({
      action: ModerationAction.EDIT_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `编辑单子详情: ${updated.title}`,
    });

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
