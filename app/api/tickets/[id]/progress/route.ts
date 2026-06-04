import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";
import { createModerationLog } from "@/lib/moderation";
import { ModerationAction } from "@prisma/client";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as { progress?: number };
    const progress = Math.max(0, Math.min(100, Number(body.progress ?? 0)));

    const ticket = await prisma.ticket.update({
      where: { id },
      data: { progress },
    });

    await createModerationLog({
      action: ModerationAction.UPDATE_TICKET_PROGRESS,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `进度更新为 ${progress}%`,
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
