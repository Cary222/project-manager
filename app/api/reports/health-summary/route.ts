import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getReportsStats,
  getWeeklyStats,
  getMonthlyStats,
} from "@/features/reports/lib/reports-store";
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

  // Try cache first (5-minute TTL)
  const cached = getCachedHealthSummary();
  if (cached && !request.nextUrl.searchParams.has("refresh")) {
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

  // Build comprehensive summary from all report data
  try {
    const [stats, weeklyStats, monthlyStats] = await Promise.all([
      getReportsStats(),
      getWeeklyStats(),
      getMonthlyStats(),
    ]);

    const { kpis, projectStatus, projectHealth, topMembers, thisWeekReports } = stats;
    const { weeklyTrend, monthlyTrend } = stats;

    const riskCount = projectStatus.risk + projectStatus.attention;
    const totalProjects =
      projectStatus.good + projectStatus.normal + projectStatus.attention + projectStatus.risk;
    const topNames = topMembers
      .slice(0, 3)
      .map((m) => m.name ?? "未知成员")
      .join("、");

    // 本周周报情况
    const { submitted, missing } = thisWeekReports;
    const reportTotal = submitted.length + missing.length;
    const weekReportRate =
      reportTotal > 0 ? Math.round((submitted.length / reportTotal) * 100) : 0;

    // 趋势分析
    let trendText = "";
    if (weeklyTrend.length >= 2) {
      const recent = weeklyTrend.slice(-3);
      const avg = recent.reduce((s, w) => s + w.done, 0) / recent.length;
      const prev = recent[0]?.done ?? avg;
      if (avg > prev * 1.2) {
        trendText = "本周交付呈上升趋势";
      } else if (avg < prev * 0.8) {
        trendText = "本周交付有所下滑";
      } else {
        trendText = "本周交付趋于平稳";
      }
    }

    // 月度趋势
    let monthlyText = "";
    if (monthlyTrend.length >= 2) {
      const last = monthlyTrend[monthlyTrend.length - 1].done;
      const prev = monthlyTrend[monthlyTrend.length - 2].done;
      const diff = last - prev;
      if (diff > 2) monthlyText = "本月交付较上月明显增长";
      else if (diff < -2) monthlyText = "本月交付较上月有所下降";
      else monthlyText = "本月交付与上月基本持平";
    }

    // 健康度评分
    const healthy = projectStatus.good + projectStatus.normal;
    const healthScore =
      totalProjects > 0
        ? Math.round((healthy / totalProjects) * 50 + kpis.completionRate * 0.5)
        : kpis.completionRate;

    // 重点关注项目
    const attentionProjects = projectHealth
      .filter((p) => p.status === "risk" || p.status === "attention")
      .sort((a, b) => a.progress - b.progress)
      .slice(0, 3);
    const attentionNames = attentionProjects
      .map((p) => `${p.name}(${p.progress}%)`)
      .join("、");

    // 建议
    let advice = "";
    if (riskCount > totalProjects * 0.5) {
      advice = "⚠️ 风险项目较多，建议优先推进关键路径";
    } else if (weekReportRate < 50) {
      advice = "📋 周报提交率偏低，建议督促团队按时提交";
    } else if (kpis.completionRate < 30) {
      advice = "📈 任务完成率有待提升，关注交付效率";
    } else {
      advice = "✨ 团队整体运行良好，保持当前节奏";
    }

    const contributor = topNames ? `本周贡献突出成员：**${topNames}**` : "";
    const reportMissingNames = missing
      .slice(0, 2)
      .map((m) => m.name ?? "未知")
      .join("、");
    const missingText =
      missing.length > 0
        ? `${reportMissingNames}${missing.length > 2 ? "等" : ""}（${missing.length}人）`
        : "本周周报已全部提交";

    const summary = `## 📊 团队健康度总结

**综合评分：${healthScore}分**（基于项目健康度 + 任务完成率）

### 项目概况
- 活跃项目 **${totalProjects}** 个，其中正常/良好 **${healthy}** 个，需关注 **${riskCount}** 个
- 本月任务完成率 **${kpis.completionRate}%**，交付 **${kpis.monthlyTickets}** 个任务
${attentionNames ? `- 🔴 重点关注：${attentionNames}` : ""}

### 周报情况
- 本周周报提交率 **${weekReportRate}%**（${submitted.length}/${reportTotal}）
- ${missing.length > 0 ? `本周未提交周报：${reportMissingNames}${missing.length > 2 ? "等" : ""}（${missing.length}人）` : "本周周报已全部提交"}

### 趋势分析
${trendText ? `- ${trendText}` : ""}
${monthlyText ? `- ${monthlyText}` : ""}

### 成员贡献
${contributor || "暂无贡献数据"}

---
${advice}`;

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
