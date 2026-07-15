import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { PRIVATE_LIST_CACHE_CONTROL } from "@/lib/cache-control";
import { extractFileAttachmentsFromLegacy } from "@/shared/lib/pkm";
import { syncPkmNoteSearchDocument } from "@/shared/lib/search";
import { recordFileReference } from "@/shared/lib/file-reference";

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

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const raw = Number(searchParams.get("take") ?? "10");
    const take = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 10;
    const notes = await prisma.pkmNote.findMany({
      where: { userId: session.user.id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take,
    });

    return NextResponse.json(
      { notes },
      {
        headers: {
          "Cache-Control": PRIVATE_LIST_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
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
    const { attachments, convertedFileIds } = await extractFileAttachmentsFromLegacy(
      body.attachments,
      session.user.id,
    );

    // 双写：PkmNote + FileReference（同一事务）
    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.pkmNote.create({
        data: {
          userId: session.user.id,
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

      // 双写 FileReference（只处理有 fileId 的附件）
      for (const att of attachments) {
        if (!att.fileId) continue; // 旧格式无 FileAsset 引用，跳过
        await recordFileReference(tx, {
          fileAssetId: att.fileId,
          sourceType: "PKM_NOTE",
          sourceId: created.id,
        });
      }

      return created;
    });

    await syncPkmNoteSearchDocument(note.id, { async: true });

    return NextResponse.json({ note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
