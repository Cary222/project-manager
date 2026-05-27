import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  assigneeUserSelect,
  loadUsersByIds,
  mapAssigneeUsers,
  normalizeAssigneeIds,
  replaceTicketAssignees,
  sameAssigneeIds,
} from "@/lib/ticket-assignees";
import { requireRoot } from "@/lib/permissions";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const body = (await request.json()) as { assigneeIds?: string[] };
    const ticketNo = Number(id);
    const nextAssigneeIds = normalizeAssigneeIds(body.assigneeIds ?? []);

    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: {
        id: true,
        assignees: { select: { userId: true } },
      },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const currentAssigneeIds = current.assignees.map((item) => item.userId);
    if (sameAssigneeIds(currentAssigneeIds, nextAssigneeIds)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: current.id },
        include: {
          assignees: {
            include: { user: { select: assigneeUserSelect } },
          },
        },
      });
      return NextResponse.json({
        ticket: ticket
          ? {
              ...ticket,
              assignees: ticket.assignees.map((item) => item.user),
            }
          : null,
      });
    }

    const ticket = await prisma.$transaction(async (tx) => {
      await replaceTicketAssignees(
        tx,
        current.id,
        nextAssigneeIds,
        session.user.id
      );
      return tx.ticket.findUnique({
        where: { id: current.id },
        include: {
          assignees: {
            include: { user: { select: assigneeUserSelect } },
          },
        },
      });
    });

    return NextResponse.json({
      ticket: ticket
        ? {
            ...ticket,
            assignees: ticket.assignees.map((item) => item.user),
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
