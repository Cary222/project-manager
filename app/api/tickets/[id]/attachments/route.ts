import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { recordFileReference, removeFileReferences } from "@/shared/lib/file-reference";
import type { FileAttachment } from "@/shared/lib/pkm";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * 工单附件管理（PR10 F6）。
 *
 * PATCH — 添加或移除工单附件（FileReference sourceType: TICKET）
 * body: { action: "add" | "remove"; attachment: FileAttachment }
 *
 * 权限：工单 assignee 或 ROOT 可操作。
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findFirst({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: { id: true, ticketNo: true, title: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isAssignee = await prisma.ticketAssignee.findFirst({
      where: { ticketId: ticket.id, userId: session.user.id },
    });
    const isRoot = session.user.role === "ROOT";
    if (!isAssignee && !isRoot) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json()) as {
      action: "add" | "remove";
      attachment?: FileAttachment;
      attachmentId?: string;
    };

    if (body.action === "add") {
      if (!body.attachment?.fileId) {
        return NextResponse.json({ error: "fileId is required" }, { status: 400 });
      }

      // 写入 FileReference（事务内 upsert）
      await prisma.$transaction(async (tx) => {
        await recordFileReference(tx, {
          fileAssetId: body.attachment!.fileId,
          sourceType: "TICKET",
          sourceId: ticket.id,
        });
      });

      return NextResponse.json({ ok: true, action: "add", fileId: body.attachment.fileId });
    }

    if (body.action === "remove") {
      if (!body.attachmentId) {
        return NextResponse.json({ error: "attachmentId is required" }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        await removeFileReferences(tx, {
          sourceType: "TICKET",
          sourceId: ticket.id,
          fileAssetIds: [body.attachmentId!],
        });
      });

      return NextResponse.json({ ok: true, action: "remove", fileId: body.attachmentId });
    }

    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
