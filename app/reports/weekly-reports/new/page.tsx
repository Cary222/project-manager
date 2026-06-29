import { AppShell } from "@/shared/ui/AppShell";
import Link from "next/link";
import { WeeklyReportForm } from "@/features/reports/weekly-reports/ui/WeeklyReportForm";
import { getWeekRange } from "@/shared/lib/week";

function formatDateInput(d: Date): string {
  return d.toISOString().split("T")[0];
}

export default async function NewWeeklyReportPage() {
  const { weekStart, weekEnd } = getWeekRange(new Date());

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">新建周报</h1>
          <p className="text-xs text-ink-400">Weekly Report · New</p>
        </div>
      }
    >
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center gap-2 text-sm text-ink-500">
          <Link
            href="/reports/weekly-reports"
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 shadow-sm transition hover:bg-ink-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            返回列表
          </Link>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-ink-900">填写周报</h2>
            <p className="mt-1 text-sm text-ink-400">
              提交后 AI 将自动生成结构化总结，可在详情页查看。
            </p>
          </div>

          <WeeklyReportForm
            initialWeekStart={formatDateInput(weekStart)}
            initialWeekEnd={formatDateInput(weekEnd)}
          />
        </div>
      </main>
    </AppShell>
  );
}
