import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as {
      status?: "FAILED" | "SUCCEEDED" | "PENDING";
      errorMessage?: string | null;
      draftTitle?: string;
      draftDescription?: string | null;
      programAssigneeIds?: string[];
      designAssigneeIds?: string[];
      targetTicketId?: string | null;
    };
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

    const record = await prisma.ticketPushRecord.upsert({
      where: { sourceTicketId: ticket.id },
      create: {
        sourceTicketId: ticket.id,
        createdById: session.user.id,
        status: body.status ?? "PENDING",
        errorMessage: body.errorMessage ?? null,
        draftTitle: body.draftTitle ?? "",
        draftDescription: body.draftDescription ?? null,
        programAssigneeIds: body.programAssigneeIds ?? [],
        designAssigneeIds: body.designAssigneeIds ?? [],
        targetTicketId: body.targetTicketId ?? null,
      },
      update: {
        status: body.status ?? undefined,
        errorMessage: body.errorMessage ?? null,
        draftTitle: body.draftTitle ?? undefined,
        draftDescription: body.draftDescription ?? null,
        programAssigneeIds: body.programAssigneeIds ?? undefined,
        designAssigneeIds: body.designAssigneeIds ?? undefined,
        targetTicketId: body.targetTicketId ?? null,
      },
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
