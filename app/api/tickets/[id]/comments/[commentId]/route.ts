import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { removeFileReferences } from "@/features/knowledge/lib/file-reference";

type RouteParams = { params: Promise<{ id: string; commentId: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const session = await requireSession();
    const { id, commentId } = await params;

    const ticketNo = Number(id);
    const ticket = await prisma.ticket.findFirst({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id: id },
      select: { id: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const comment = await prisma.ticketComment.findUnique({
      where: { id: commentId },
      select: { id: true, ticketId: true, authorId: true },
    });
    if (!comment || comment.ticketId !== ticket.id) {
      return NextResponse.json({ error: "comment not found" }, { status: 404 });
    }

    const isRoot = session.user.role === "ROOT";
    const isAuthor = comment.authorId === session.user.id;

    if (!isRoot && !isAuthor) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // PR10 F5: 事务内删除评论 + 清理 FileReference
    await prisma.$transaction(async (tx) => {
      await tx.ticketComment.delete({ where: { id: commentId } });
      await removeFileReferences(tx, {
        sourceType: "TICKET_COMMENT",
        sourceId: commentId,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
