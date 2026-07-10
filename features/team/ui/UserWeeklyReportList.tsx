"use client";

import Link from "next/link";
import type { WeeklyReportWithProjects } from "@/features/weekly-reports/lib/weekly-report-store";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

type Props = {
  reports: WeeklyReportWithProjects[];
  userName: string;
  isOwnProfile: boolean;
};

export function UserWeeklyReportList({ reports, userName, isOwnProfile }: Props) {
  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
        <div className="rounded-full bg-ink-100 p-3 text-ink-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有周报</h3>
        <p className="mt-1 text-sm text-ink-500">
          {isOwnProfile ? "开始记录你的第一周工作吧" : `${userName} 还没有提交周报`}
        </p>
        {isOwnProfile && (
          <Link
            href="/reports/weekly-reports/new"
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            新建周报
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 pm-fade-in">
      {reports.map((report) => (
        <div
          key={report.id}
          className="group rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-ink-300 hover:shadow lg:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/reports/weekly-reports/${report.id}`} className="block">
                <h3 className="truncate text-base font-medium text-ink-900 hover:text-brand-600">
                  {report.title}
                </h3>
              </Link>

              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                <span>{formatDate(report.weekStart)} — {formatDate(report.weekEnd)}</span>
                {report.projects.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    {report.projects.map((p) => p.name).join(", ")}
                  </span>
                )}
                {report.aiSummary !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI 总结
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/reports/weekly-reports/${report.id}`}
                className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
              >
                查看
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
