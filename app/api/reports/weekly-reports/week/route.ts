import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { getWeekRangeByOffset } from "@/shared/lib/week";

export const dynamic = "force-dynamic";

/**
 * 获取指定周的所有人周报列表 + 提交/未提交统计。
 *
 * Query params:
 *   - weekOffset: 0 = 本周, 1 = 上周, 2 = 上上周, ...（默认 0）
 *
 * 用于 Dashboard 中展示任意周的提交情况。
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawOffset = Number.parseInt(searchParams.get("weekOffset") ?? "0", 10);
    const weekOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const { weekStart, weekEnd } = getWeekRangeByOffset(weekOffset);

    // 一次查询拿到该周所有周报 + 全员用户，节省一次往返
    const [reports, allUsers] = await Promise.all([
      prisma.weeklyReport.findMany({
        where: {
          createdAt: { gte: weekStart, lte: weekEnd },
        },
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, email: true, image: true },
          },
          projects: {
            include: {
              project: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: { bannedAt: null },
        select: { id: true, name: true, email: true, image: true },
      }),
    ]);

    const submittedIds = new Set(reports.map((r) => r.userId));
    const submitted = allUsers.filter((u) => submittedIds.has(u.id));
    const missing = allUsers.filter((u) => !submittedIds.has(u.id));

    const result = reports.map((report) => ({
      id: report.id,
      title: report.title,
      content: report.content?.slice(0, 200) ?? "",
      createdAt: report.createdAt.toISOString(),
      user: {
        id: report.user.id,
        name: report.user.name,
        email: report.user.email,
        image: report.user.image,
      },
      projects: report.projects.map((rp) => ({
        id: rp.project.id,
        name: rp.project.name,
      })),
      hasAiSummary: !!report.aiSummary,
    }));

    return NextResponse.json(
      {
        reports: result,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        weekOffset,
        submitted,
        missing,
        total: result.length,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err) {
    console.error("[api/reports/weekly-reports/week] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
