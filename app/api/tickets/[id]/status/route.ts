import { NextResponse } from "next/server";
import { TicketStatus, ModerationAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";
import { createModerationLog } from "@/lib/moderation";

const STATUS_VALUES = new Set<string>(Object.values(TicketStatus));

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (!body.status || !STATUS_VALUES.has(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const ticketNo = Number(id);
    const nextStatus = body.status as TicketStatus;

    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: { id: true, ticketNo: true, status: true },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    if (current.status === nextStatus) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: current.id },
      });
      return NextResponse.json({ ticket });
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: current.id },
        data: { status: nextStatus },
      });
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: current.id,
          status: nextStatus,
          changedById: session.user.id,
        },
      });
      return updated;
    });

    await createModerationLog({
      action: ModerationAction.UPDATE_TICKET_STATUS,
      targetId: current.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `状态变更为 ${nextStatus}`,
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
