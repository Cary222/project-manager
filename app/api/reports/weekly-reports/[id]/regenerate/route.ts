import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { enqueueSummarizeWeeklyReport } from "@/features/reports/weekly-reports/lib/background-jobs";

/**
 * POST /api/reports/weekly-reports/[id]/regenerate
 *
 * PR4 实现：手动触发用户画像刷新。
 *
 * 实际行为：周报提交/更新后只刷新用户画像，不刷新周报本身的 aiSummary。
 * （weeklyReport 暂时没有 "summary" 字段，只有 aiSummary，PR5+ 再加真正的 AI 总结生成。）
 *
 * 语义保留："重新生成" → 基于最新周报内容重新刷新 AiUserProfile（预计 5-30 秒完成）。
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: reportId } = await params;

  // 校验 report 归属
  const report = await prisma.weeklyReport.findUnique({
    where: { id: reportId },
    select: { userId: true },
  });

  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (report.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 入队用户画像刷新
  enqueueSummarizeWeeklyReport(reportId);

  return NextResponse.json(
    {
      ok: true,
      enqueued: true,
      reportId,
      message:
        "用户画像刷新已入队（实际是基于周报内容更新 AiUserProfile，预计 5-30 秒完成）",
    },
    { status: 202 }
  );
}
