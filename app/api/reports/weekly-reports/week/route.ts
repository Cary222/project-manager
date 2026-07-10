import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { getWeekRange } from "@/shared/lib/week";

export const dynamic = "force-dynamic";

/**
 * 获取本周所有人的周报列表
 * 用于 Dashboard 中展示本周提交情况
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { weekStart, weekEnd } = getWeekRange(new Date());

    // 查询本周所有周报，按用户分组
    const reports = await prisma.weeklyReport.findMany({
      where: {
        createdAt: { gte: weekStart, lte: weekEnd },
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        projects: {
          include: {
            project: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    // 转换为扁平结构
    const result = reports.map((report) => ({
      id: report.id,
      title: report.title,
      content: report.content?.slice(0, 200) ?? "", // 截取前200字符作为预览
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
