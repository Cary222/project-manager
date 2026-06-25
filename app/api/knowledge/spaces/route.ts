import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { ACTION } from "@/shared/lib/events/ACTION";

export const dynamic = "force-dynamic";

export async function GET() {
  const [projects, noteHotRows] = await Promise.all([
    prisma.project.findMany({
      include: {
        pkmNotes: { select: { id: true }, where: { isPublic: true } },
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

  const spaces = projects.map((p) => {
    const hotScore = p.pkmNotes.reduce((sum, note) => sum + (noteViews.get(note.id) ?? 0), 0);
    const combinedScore = hotScore + p._count.pkmNotes;
    return {
      id: p.id,
      name: p.name,
      noteCount: p._count.pkmNotes,
      hotScore,
      combinedScore,
    };
  });

  spaces.sort((a, b) => b.combinedScore - a.combinedScore);

  return NextResponse.json(spaces.slice(0, 4));
}
