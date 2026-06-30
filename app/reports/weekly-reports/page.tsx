import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listMyWeeklyReports } from "@/features/weekly-reports/lib/weekly-report-store";
import { WeeklyReportList } from "@/features/reports/weekly-reports/ui/WeeklyReportList";

export default async function WeeklyReportsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const reports = await listMyWeeklyReports(session.user.id);

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref="/reports"
          backLabel="返回报表"
          title="我的周报"
          subtitle="Weekly Reports · 个人工作回顾"
        />
      }
    >
      <div className="mx-auto max-w-3xl px-0 sm:px-6">
        <div className="pm-fade-in">
          {/* Section title + create button */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                {reports.length > 0 ? `共 ${reports.length} 份周报` : "周报列表"}
              </h2>
              <p className="mt-0.5 text-sm text-ink-500">
                提交后 AI 将自动生成结构化总结
              </p>
            </div>
            <a
              href="/reports/weekly-reports/new"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
            >
              新建周报
            </a>
          </div>

          <WeeklyReportList initialReports={reports} />
        </div>
      </div>
    </AppShell>
  );
}
