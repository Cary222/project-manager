import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReportsStats } from "@/features/reports/lib/reports-store";
import { getCachedHealthSummary, setCachedHealthSummary } from "@/shared/lib/health-cache";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ROOT only
  if (session.user.role !== "ROOT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Try cache first
  const cached = getCachedHealthSummary();
  if (cached) {
    return NextResponse.json(
      {
        data: {
          summary:     cached.summary,
          generatedAt: cached.generatedAt.toISOString(),
          fromCache:   true,
        },
        error: null,
      },
      { status: 200 }
    );
  }

  // Build summary from stats
  try {
    const stats = await getReportsStats();
    const { kpis, projectStatus, topMembers } = stats;

    const topNames = topMembers.slice(0, 3).map((m) => m.name ?? "未知成员").join("、");
    const riskCount = projectStatus.risk + projectStatus.attention;

    const prompt = `你是 PMO 专家，根据下列团队数据给出健康度总结（Markdown，200 字内）：
- 活跃项目数：${kpis.activeProjects}
- 按期完成率：${kpis.completionRate}%
- 本月任务数：${kpis.monthlyTickets}
- 风险项目：${riskCount} 个
- TOP 完成者：${topNames || "暂无数据"}`;

    // In PR2 we don't have real LLM, so generate a template summary
    // PR4 will replace this with actual AI call
    const summary = generateTemplateSummary(kpis, projectStatus, topMembers);

    setCachedHealthSummary(summary);

    return NextResponse.json(
      {
        data: {
          summary,
          generatedAt: new Date().toISOString(),
          fromCache: false,
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[api/reports/health-summary] error:", err);
    return NextResponse.json(
      { data: null, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/** Template summary (PR2 placeholder — PR4 replaces with real LLM) */
function generateTemplateSummary(
  kpis: { activeProjects: number; completionRate: number; monthlyTickets: number },
  projectStatus: { good: number; normal: number; attention: number; risk: number },
  topMembers: Array<{ name: string | null; done: number }>
): string {
  const riskCount = projectStatus.risk + projectStatus.attention;
  const topNames  = topMembers.slice(0, 3).map((m) => m.name ?? "未知").join("、");

  let body = "";
  if (riskCount === 0) {
    body = `团队整体表现良好，${kpis.activeProjects} 个活跃项目均处于健康状态，本月已交付 ${kpis.monthlyTickets} 个任务，完成率达 ${kpis.completionRate}%。`;
  } else {
    body = `团队整体运行平稳，${kpis.activeProjects} 个项目中 ${riskCount} 个需关注（${projectStatus.risk} 风险 + ${projectStatus.attention} 关注），本月任务完成率 ${kpis.completionRate}%。建议优先推进风险项目的关键路径。`;
  }

  const contributor = topNames ? `本周贡献突出成员：${topNames}。` : "";

  return `## 团队健康度总结\n\n${body}\n\n${contributor}\n\n> 此总结为模板占位，PR4 将由 AI 实时生成。`;
}
