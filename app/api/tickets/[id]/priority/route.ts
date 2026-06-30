import { NextResponse } from "next/server";
import { ModerationAction } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";

const PRIORITY_VALUES = [0, 1, 2, 3] as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as { priority?: number };
    if (body.priority === undefined || !PRIORITY_VALUES.includes(body.priority as typeof PRIORITY_VALUES[number])) {
      return NextResponse.json({ error: "invalid priority" }, { status: 400 });
    }

    const nextPriority = body.priority;

    const ticketNo = Number(id);
    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: {
        id: true,
        ticketNo: true,
        priority: true,
        assignees: { select: { userId: true } },
        creatorId: true,
      },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isAssignee = current.assignees.some((item) => item.userId === session.user.id);
    const isRoot = session.user.role === "ROOT";
    if (!isRoot && !isAssignee) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (current.priority === nextPriority) {
      return NextResponse.json({ ticket: current });
    }

    const ticket = await prisma.ticket.update({
      where: { id: current.id },
      data: { priority: nextPriority },
    });

    await createModerationLog({
      action: ModerationAction.EDIT_TICKET,
      targetId: current.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `优先级变更为 P${nextPriority}`,
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
