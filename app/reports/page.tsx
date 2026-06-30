import { AppShell } from "@/shared/ui/AppShell";
import {
  getReportsStats,
  getWeeklyStats,
  getMonthlyStats,
  getHalfYearStats,
} from "@/features/reports/lib/reports-store";
import { auth } from "@/lib/auth";
import {
  ReportsKpiCards,
  ReportsDashboard,
  ReportsProjectStatus,
  ReportsProjectHealth,
  ReportsHealthAi,
} from "@/features/reports/ui";

export default async function ReportsPage() {
  const session = await auth();

  const [stats, weeklyStats, monthlyStats, halfYearStats] = await Promise.all([
    getReportsStats(),
    getWeeklyStats(),
    getMonthlyStats(),
    getHalfYearStats(),
  ]);

  // teamHealth: only ROOT gets real score
  if (session?.user?.role !== "ROOT") {
    stats.kpis.teamHealth = 0;
  } else {
    const { projectStatus } = stats;
    const { completionRate } = stats.kpis;
    const healthy = projectStatus.good + projectStatus.normal;
    const total   = healthy + projectStatus.attention + projectStatus.risk;
    const score   = total > 0
      ? Math.round((healthy / total) * 50 + completionRate * 0.5)
      : completionRate;
    stats.kpis.teamHealth = Math.min(100, score);
  }

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">报表</h1>
          <p className="text-xs text-ink-400">Management Dashboard · 全局经营视角</p>
        </div>
      }
    >
      <div className="space-y-6 pm-fade-in">
        {/* KPI */}
        <ReportsKpiCards kpis={stats.kpis} />

        <div className="grid gap-5 lg:grid-cols-3">
          {/* 报表仪表盘（Tab 切换 + 周期选择） */}
          <ReportsDashboard
            weeklyStats={weeklyStats}
            monthlyStats={monthlyStats}
            halfYearStats={halfYearStats}
          />

          {/* 项目状态占比 */}
          <ReportsProjectStatus status={stats.projectStatus} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 项目健康度 */}
          <ReportsProjectHealth projects={stats.projectHealth} />
        </div>

        {/* AI 健康度（ROOT only — component handles its own auth display） */}
        <ReportsHealthAi />
      </div>
    </AppShell>
  );
}
