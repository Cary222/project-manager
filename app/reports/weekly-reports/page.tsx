import { AppShell } from "@/shared/ui/AppShell";
import Link from "next/link";
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
        <div>
          <h1 className="text-lg font-semibold leading-tight">我的周报</h1>
          <p className="text-xs text-ink-400">Weekly Reports · 个人工作回顾</p>
        </div>
      }
    >
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">
              {reports.length > 0 ? `共 ${reports.length} 份周报` : "周报列表"}
            </h2>
            <p className="mt-0.5 text-sm text-ink-400">
              提交后 AI 将自动生成结构化总结
            </p>
          </div>
          <Link
            href="/reports/weekly-reports/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新建周报
          </Link>
        </div>

        <WeeklyReportList initialReports={reports} />
      </main>
    </AppShell>
  );
}
