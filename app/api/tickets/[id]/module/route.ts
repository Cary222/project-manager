import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireRoot } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction } from "@prisma/client";
import { syncTicketSearchDocument } from "@/shared/lib/search";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireRoot();
    const { id } = await params;
    const body = (await request.json()) as { moduleId?: string };

    if (!body.moduleId) {
      return NextResponse.json({ error: "moduleId is required" }, { status: 400 });
    }

    const ticketNo = Number(id);
    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: { module: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const newModule = await prisma.module.findUnique({
      where: { id: body.moduleId },
    });
    if (!newModule) {
      return NextResponse.json({ error: "module not found" }, { status: 404 });
    }

    if (newModule.responsibilityId !== ticket.module.responsibilityId) {
      return NextResponse.json(
        { error: "Cannot move ticket to module in different responsibility" },
        { status: 400 }
      );
    }

    if (ticket.moduleId === body.moduleId) {
      return NextResponse.json({ ticket });
    }

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { moduleId: body.moduleId },
    });
    await syncTicketSearchDocument(ticket.id);

    await createModerationLog({
      action: ModerationAction.CHANGE_TICKET_MODULE,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `移动单子从模块 ${ticket.module.name} 到 ${newModule.name}`,
    });

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
