import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { extractFileAttachmentsFromLegacy } from "@/features/knowledge/lib/pkm";
import { SEARCH_DOCUMENT_SOURCE_TYPES } from "@/features/knowledge/lib/search-types";
import {
  buildSearchDocumentSourceType,
  syncPkmNoteSearchDocument,
} from "@/features/knowledge/lib/search";
import { recordFileReference, removeFileReferences } from "@/features/knowledge/lib/file-reference";

type Params = { params: Promise<{ id: string }> };

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return [] as string[];

  return Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const note = await prisma.pkmNote.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!note) {
      return NextResponse.json({ error: "note not found" }, { status: 404 });
    }

    if (note.userId !== session.user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json()) as {
      title?: string;
      content?: string;
      tags?: unknown;
      projectId?: string | null;
      isPublic?: boolean;
      attachments?: unknown;
    };

    const title = body.title?.trim();
    const content = body.content?.trim();
    const projectId = body.projectId?.trim() || null;
    const isPublic = body.isPublic === true;
    const tags = normalizeTags(body.tags);

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    if (projectId) {
      const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) {
        return NextResponse.json({ error: "project not found" }, { status: 404 });
      }
    }

    // 提取附件（新格式 + 旧 base64 转换）
    const { attachments } = await extractFileAttachmentsFromLegacy(
      body.attachments,
      session.user.id,
    );

    // 双写：软删除旧 FileReference + 写新 FileReference + 更新 PkmNote（同一事务）
    const updated = await prisma.$transaction(async (tx) => {
      // 1. 软删除旧引用
      await removeFileReferences(tx, { sourceType: "PKM_NOTE", sourceId: id });

      // 2. 写新引用（只处理有 fileId 的附件）
      for (const att of attachments) {
        if (!att.fileId) continue; // 旧格式无 FileAsset 引用，跳过
        await recordFileReference(tx, {
          fileAssetId: att.fileId,
          sourceType: "PKM_NOTE",
          sourceId: id,
        });
      }

      // 3. 更新 PkmNote
      return tx.pkmNote.update({
        where: { id },
        data: {
          title,
          content,
          tags,
          projectId,
          isPublic,
          attachments: attachments as unknown as Prisma.InputJsonValue,
        },
        include: {
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });

    await syncPkmNoteSearchDocument(updated.id, { async: true });

    return NextResponse.json({ note: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const note = await prisma.pkmNote.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!note) {
      return NextResponse.json({ error: "note not found" }, { status: 404 });
    }

    if (note.userId !== session.user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // 清理关联资源
    // 1. 软删除 FileReferences（防止 FileAsset 误删）
    await prisma.$transaction(async (tx) => {
      await tx.fileReference.updateMany({
        where: { sourceType: "PKM_NOTE", sourceId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });

    // 2. 清理 SearchDocument（会被 PkmNote FK Cascade 自动清理，但显式删更干净）
    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE),
        sourceId: id,
      },
    });

    await prisma.pkmNote.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
