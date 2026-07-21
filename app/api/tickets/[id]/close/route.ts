import { NextResponse } from "next/server";
import { TicketStatus, ModerationAction } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireRoot } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { enqueueIndexJob } from "@/shared/lib/jobs";

// Auto-start the overdue scanner when this module is first loaded
void import("@/worker/lib/cron-scheduler").catch(() => {});

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        assignees: { select: { userId: true } },
        creatorId: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    // Cannot close if already in terminal state
    if (
      ticket.status === TicketStatus.DONE ||
      ticket.status === TicketStatus.CLOSED
    ) {
      return NextResponse.json(
        { error: "ticket already in terminal state" },
        { status: 400 }
      );
    }

    const updatedTicket = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: TicketStatus.CLOSED },
      });

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          status: TicketStatus.CLOSED,
          changedById: session.user.id,
        },
      });

      return updated;
    });

    await enqueueIndexJob({ targetType: "TICKET", targetId: ticket.id });

    await createModerationLog({
      action: ModerationAction.UPDATE_TICKET_STATUS,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `关闭单子 #${ticket.ticketNo}: ${ticket.title}`,
    });

    return NextResponse.json({ ticket: updatedTicket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
