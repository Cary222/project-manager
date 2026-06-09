import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";
import { syncPkmNoteSearchDocument } from "@/lib/search";

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
    };

    const title = body.title?.trim();
    const content = body.content?.trim();
    const projectId = body.projectId?.trim() || null;
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

    const updated = await prisma.pkmNote.update({
      where: { id },
      data: {
        title,
        content,
        tags,
        projectId,
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

    await syncPkmNoteSearchDocument(updated.id);

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

    await prisma.pkmNote.delete({ where: { id } });
    await syncPkmNoteSearchDocument(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
