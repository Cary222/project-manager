import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);
    const body = (await request.json()) as {
      bugTicketId?: string;
      draftTitle?: string;
    };

    const programTicket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: { userId: true },
        },
      },
    });

    if (!programTicket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const canUpdate =
      programTicket.creatorId === session.user.id ||
      programTicket.assignees.some((a) => a.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canUpdate) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (!body.bugTicketId) {
      return NextResponse.json({ error: "bugTicketId is required" }, { status: 400 });
    }

    const bugTicket = await prisma.ticket.findUnique({
      where: { id: body.bugTicketId },
    });

    if (!bugTicket) {
      return NextResponse.json({ error: "bug ticket not found" }, { status: 404 });
    }

    const existing = await prisma.bugProgramBinding.findUnique({
      where: {
        bugTicketId_programTicketId: {
          bugTicketId: body.bugTicketId,
          programTicketId: programTicket.id,
        },
      },
    });

    if (existing) {
      return NextResponse.json({ error: "bug already bound to this program ticket" }, { status: 409 });
    }

    const binding = await prisma.bugProgramBinding.create({
      data: {
        bugTicketId: body.bugTicketId,
        programTicketId: programTicket.id,
        draftTitle: body.draftTitle ?? bugTicket.title,
        boundById: session.user.id,
      },
      include: {
        bugTicket: {
          select: { id: true, ticketNo: true, title: true },
        },
        boundBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json({
      binding: {
        id: binding.id,
        draftTitle: binding.draftTitle,
        createdAt: binding.createdAt.toISOString(),
        bugTicket: binding.bugTicket,
        boundBy: binding.boundBy,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const bindingId = searchParams.get("bindingId");

    if (!bindingId) {
      return NextResponse.json({ error: "bindingId is required" }, { status: 400 });
    }

    const binding = await prisma.bugProgramBinding.findUnique({
      where: { id: bindingId },
      include: {
        programTicket: {
          include: {
            assignees: { select: { userId: true } },
          },
        },
      },
    });

    if (!binding) {
      return NextResponse.json({ error: "binding not found" }, { status: 404 });
    }

    const canDelete =
      binding.programTicket.creatorId === session.user.id ||
      binding.programTicket.assignees.some((a) => a.userId === session.user.id) ||
      binding.boundById === session.user.id ||
      session.user.role === "ROOT";

    if (!canDelete) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    await prisma.bugProgramBinding.delete({
      where: { id: bindingId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
