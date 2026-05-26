import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot } from "@/lib/permissions";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const body = (await request.json()) as { assigneeId?: string | null };
    const ticketNo = Number(id);

    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: { id: true, assigneeId: true },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const nextAssigneeId = body.assigneeId || null;
    if (current.assigneeId === nextAssigneeId) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: current.id },
        include: {
          assignee: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });
      return NextResponse.json({ ticket });
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: current.id },
        data: { assigneeId: nextAssigneeId },
        include: {
          assignee: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      });
      await tx.ticketAssigneeHistory.create({
        data: {
          ticketId: current.id,
          assigneeId: nextAssigneeId,
          changedById: session.user.id,
        },
      });
      return updated;
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
