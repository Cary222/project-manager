import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireRoot, requireSession } from "@/shared/lib/permissions";
import { ResponsibilityKind } from "@prisma/client";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction } from "@prisma/client";
import { PRIVATE_LIST_CACHE_CONTROL } from "@/lib/cache-control";
import { ACTION } from "@/shared/lib/events/ACTION";

type ProjectWithScores = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  hotScore: number;
  combinedScore: number;
};

export async function GET() {
  try {
    await requireSession();
    const [projects, noteHotRows] = await Promise.all([
      prisma.project.findMany({
        include: {
          pkmNotes: { select: { id: true } },
          _count: { select: { pkmNotes: true } },
        },
      }),
      prisma.activityLog.groupBy({
        by: ["targetId"],
        where: {
          action: ACTION.PAGE_VIEW,
          targetType: "note",
          isValidView: true,
        },
        _count: { targetId: true },
      }),
    ]);

    const noteViews = new Map<string, number>();
    for (const row of noteHotRows as { targetId: string | null; _count: { targetId: number } }[]) {
      if (row.targetId) noteViews.set(row.targetId, row._count.targetId);
    }

    const scoredProjects: ProjectWithScores[] = projects.map((p: typeof projects[number]) => {
      const hotScore = p.pkmNotes.reduce((sum: number, note: { id: string }) => sum + (noteViews.get(note.id) ?? 0), 0);
      const combinedScore = hotScore + p._count.pkmNotes;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        ownerId: p.ownerId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        hotScore,
        combinedScore,
      };
    });

    scoredProjects.sort((a, b) => b.combinedScore - a.combinedScore);

    return NextResponse.json(
      { projects: scoredProjects },
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
    const session = await requireRoot();
    const body = (await request.json()) as { name?: string; description?: string };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          description: body.description?.trim() || null,
          ownerId: session.user.id,
        },
      });

      await tx.userOnProject.create({
        data: {
          userId: session.user.id,
          projectId: created.id,
          role: "OWNER",
        },
      });

      await tx.responsibility.createMany({
        data: [
          { projectId: created.id, kind: ResponsibilityKind.PROGRAM },
          { projectId: created.id, kind: ResponsibilityKind.DESIGN },
        ],
      });

      return created;
    });

    await createModerationLog({
      action: ModerationAction.CREATE_PROJECT,
      targetId: project.id,
      targetType: "Project",
      actorId: session.user.id,
      reason: `创建项目: ${project.name}`,
    });

    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
