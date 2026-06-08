import { NextResponse } from "next/server";
import { TicketStatus, ModerationAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assigneeUserSelect,
  normalizeAssigneeIds,
  replaceTicketAssignees,
} from "@/lib/ticket-assignees";
import { requireRoot, requireSession } from "@/lib/permissions";
import { allocateTicketNo, syncTicketCounterAfterCreate } from "@/lib/ticket-counter";
import { createModerationLog } from "@/lib/moderation";
import {
  buildAssignedNotification,
  createManyNotifications,
} from "@/lib/notifications";

export async function POST(request: Request) {
  try {
    const session = await requireRoot();
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      projectId?: string;
      moduleId?: string;
      assigneeId?: string;
      assigneeIds?: string[];
      status?: TicketStatus;
      repoPaths?: string[];
    };

    if (!body.title?.trim() || !body.projectId || !body.moduleId) {
      return NextResponse.json(
        { error: "title, projectId and moduleId are required" },
        { status: 400 }
      );
    }

    const title = body.title.trim();
    const projectId = body.projectId;
    const moduleId = body.moduleId;
    const ticketNo = await allocateTicketNo();
    const assigneeIds = normalizeAssigneeIds(
      body.assigneeIds ?? (body.assigneeId ? [body.assigneeId] : [])
    );

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo,
          title,
          description: body.description?.trim() || null,
          projectId,
          moduleId,
          creatorId: session.user.id,
          status: body.status ?? TicketStatus.DEVELOPING,
          repoBindings: {
            create: (body.repoPaths ?? [])
              .filter((repoPath) => repoPath.trim().length > 0)
              .map((repoPath) => ({ repoPath: repoPath.trim() })),
          },
        },
        include: { repoBindings: true },
      });

      await replaceTicketAssignees(
        tx,
        created.id,
        assigneeIds,
        session.user.id
      );

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          status: body.status ?? TicketStatus.DEVELOPING,
          changedById: session.user.id,
        },
      });

      return created;
    });

    await syncTicketCounterAfterCreate(ticket.ticketNo);

    if (assigneeIds.length > 0) {
      const actorName = session.user.name || session.user.email || "管理员";
      const notification = buildAssignedNotification({
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        actorName,
      });
      await createManyNotifications({
        userIds: assigneeIds,
        type: "TICKET_ASSIGNED",
        title: notification.title,
        content: notification.content,
        ticketId: ticket.id,
        actorId: session.user.id,
      });
    }

    await createModerationLog({
      action: ModerationAction.CREATE_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `创建单子 #${ticket.ticketNo}: ${ticket.title}`,
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET() {
  try {
    await requireSession();
    const tickets = await prisma.ticket.findMany({
      orderBy: { ticketNo: "desc" },
      include: {
        module: { include: { responsibility: true } },
        assignees: {
          include: { user: { select: assigneeUserSelect } },
        },
        repoBindings: true,
        commits: {
          orderBy: { committedAt: "desc" },
          take: 20,
        },
      },
    });
    return NextResponse.json({
      tickets: tickets.map((ticket) => ({
        ...ticket,
        assignees: ticket.assignees.map((item) => item.user),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
