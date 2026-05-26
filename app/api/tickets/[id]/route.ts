import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);
    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, role: true },
        },
        module: {
          include: {
            responsibility: true,
          },
        },
        commits: {
          orderBy: { committedAt: "desc" },
        },
        assigneeHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            assignee: {
              select: { id: true, name: true, email: true, role: true },
            },
            changedBy: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            changedBy: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireRoot();
    const { id } = await context.params;
    const ticketNo = Number(id);
    await prisma.ticket.delete({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
