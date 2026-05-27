import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  assigneeUserSelect,
  loadUsersByIds,
  mapAssigneeUsers,
  normalizeAssigneeIds,
  replaceTicketAssignees,
} from "@/lib/ticket-assignees";
import { requireRoot, requireSession } from "@/lib/permissions";

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
          select: { id: true, name: true },
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
        assignees: ticket.assignees.map((item) => item.user),
        assigneeHistory,
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
    await requireRoot();
    const { id } = await context.params;
    const ticketNo = Number(id);
    await prisma.ticket.delete({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
