import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { ACTION } from "@/shared/lib/events/ACTION";

export const dynamic = "force-dynamic";

type HotRow = { targetId: string | null; _count: { targetId: number } };

export async function GET() {
  const [recent, hotRows] = await Promise.all([
    prisma.pkmNote.findMany({
      where: { isPublic: true },
      include: {
        user: { select: { name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.activityLog.groupBy({
      by: ["targetId"],
      where: {
        action: ACTION.PAGE_VIEW,
        targetType: "note",
        isValidView: true,
      },
      _count: { targetId: true },
      orderBy: { _count: { targetId: "desc" } },
      take: 8,
    }),
  ]);

  const typedRows = hotRows as HotRow[];
  const hotIds = typedRows.map((r: HotRow) => r.targetId).filter((id: string | null): id is string => !!id);

  const hot =
    hotIds.length > 0
      ? await prisma.pkmNote.findMany({
          where: { id: { in: hotIds }, isPublic: true },
          include: {
            user: { select: { name: true, email: true } },
            project: { select: { id: true, name: true } },
          },
        })
      : [];

  const views = new Map(typedRows.map((r: HotRow) => [r.targetId, r._count.targetId]));
  const hotWithViews = hot
    .map((n) => ({ note: n, views: views.get(n.id) ?? 0 }))
    .sort((a, b) => b.views - a.views);

  return NextResponse.json({ recent, hot: hotWithViews });
}
