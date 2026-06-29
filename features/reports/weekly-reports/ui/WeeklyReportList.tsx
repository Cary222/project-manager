"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { WeeklyReportWithProjects } from "@/features/weekly-reports/lib/weekly-report-store";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function WeeklyReportList({ initialReports }: { initialReports: WeeklyReportWithProjects[] }) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除这份周报吗？此操作不可撤销。")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/reports/weekly-reports/${id}`, { method: "DELETE" });
      if (res.ok) {
        setReports((prev) => prev.filter((r) => r.id !== id));
        toast.success("周报已删除");
        router.refresh();
      } else {
        toast.error("删除失败，请重试");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeletingId(null);
    }
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-white p-12 text-center shadow-soft">
        <p className="text-sm font-medium text-ink-700">还没有周报</p>
        <p className="mt-1 text-sm text-ink-400">开始记录你的第一周工作吧</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <div
          key={report.id}
          className="group rounded-xl border border-ink-200 bg-white p-4 shadow-soft transition hover:border-brand-200 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link
                href={`/reports/weekly-reports/${report.id}`}
                className="block"
              >
                <h3 className="truncate text-base font-medium text-ink-900 hover:text-brand-600">
                  {report.title}
                </h3>
              </Link>

              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-400">
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
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-600">
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
                className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-600 shadow-sm transition hover:bg-brand-50 hover:border-brand-200"
              >
                查看
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(report.id)}
                disabled={deletingId === report.id}
                className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-danger opacity-0 transition hover:border-danger/30 hover:bg-red-50 group-hover:opacity-100 disabled:opacity-50"
              >
                {deletingId === report.id ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
