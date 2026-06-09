import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";
import { PRIVATE_LIST_CACHE_CONTROL } from "@/lib/cache-control";
import { syncPkmNoteSearchDocument } from "@/lib/search";

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

export async function GET() {
  try {
    const session = await requireSession();
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

    const note = await prisma.pkmNote.create({
      data: {
        userId: session.user.id,
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

    await syncPkmNoteSearchDocument(note.id);

    return NextResponse.json({ note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
