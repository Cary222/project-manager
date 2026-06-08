import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: {
        id: true,
        creatorId: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    if (ticket.creatorId !== session.user.id && session.user.role !== "ROOT") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const record = await prisma.ticketPushRecord.findUnique({
      where: { sourceTicketId: ticket.id },
      include: {
        targetTicket: {
          select: {
            id: true,
            ticketNo: true,
            title: true,
          },
        },
      },
    });

    return NextResponse.json({ record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
