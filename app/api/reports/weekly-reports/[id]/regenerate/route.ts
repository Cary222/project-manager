import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { enqueueSummarizeWeeklyReport } from "@/features/reports/weekly-reports/lib/background-jobs";

/**
 * POST /api/reports/weekly-reports/[id]/regenerate
 *
 * 手动触发周报 AI 总结重新生成。
 * 调用 enqueueSummarizeWeeklyReport，后者依次完成：
 *   1. 写 aiSummaryPartial: true → UI 显示"生成中"
 *   2. 调 LLM 生成新的 aiSummary
 *   3. 写 aiSummary + aiSummaryPartial: false + aiSummaryAt
 *   4. 触发 enqueueUpdateProfile 刷新用户画像
 *
 * 语义："重新生成" → 基于最新周报内容重新生成 AI 总结并刷新画像。
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

  // 入队 AI 总结重新生成
  enqueueSummarizeWeeklyReport(reportId);

  return NextResponse.json(
    {
      ok: true,
      enqueued: true,
      reportId,
      message:
        "AI 总结重新生成已入队，稍后请刷新页面查看",
    },
    { status: 202 }
  );
}
