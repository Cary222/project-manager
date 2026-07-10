"use client";

import Link from "next/link";
import useSWR from "swr";
import { formatWeekLabel } from "@/shared/lib/week";
import { fetchJson } from "@/shared/api/fetch-json";

interface WeekReportUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface WeekReportProject {
  id: string;
  name: string;
}

interface WeekReport {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  user: WeekReportUser;
  projects: WeekReportProject[];
  hasAiSummary: boolean;
}

interface WeekReportsResponse {
  reports: WeekReport[];
  weekStart: string;
  weekEnd: string;
  total: number;
}

function Avatar({ src, name, email }: { src: string | null; name: string | null; email: string }) {
  const initial = (name ?? email).slice(0, 1).toUpperCase();
  return src ? (
    <img
      src={src}
      alt={name ?? email}
      className="h-6 w-6 rounded-full border border-white object-cover"
    />
  ) : (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white bg-brand-100 text-xs font-medium text-brand-600">
      {initial}
    </div>
  );
}

function ReportCard({ report }: { report: WeekReport }) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Link
      href={`/reports/weekly-reports/${report.id}`}
      className="block rounded-lg border border-ink-200 bg-white p-3 transition-all hover:border-brand-300 hover:bg-brand-50"
    >
      <div className="flex items-start gap-3">
        <Avatar src={report.user.image} name={report.user.name} email={report.user.email} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="truncate text-sm font-medium text-ink-900">
              {report.title || "无标题周报"}
            </h4>
            {report.hasAiSummary && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600">
                AI 总结
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-400">
            {report.user.name ?? report.user.email.split("@")[0]} · {formatDate(report.createdAt)}
          </p>
          {report.content && (
            <p className="mt-1.5 line-clamp-2 text-xs text-ink-500">{report.content}</p>
          )}
          {report.projects.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {report.projects.slice(0, 3).map((p) => (
                <span
                  key={p.id}
                  className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600"
                >
                  {p.name}
                </span>
              ))}
              {report.projects.length > 3 && (
                <span className="text-xs text-ink-400">+{report.projects.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-ink-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="h-6 w-6 rounded-full bg-ink-100" />
        <div className="flex-1">
          <div className="h-4 w-3/4 rounded bg-ink-100" />
          <div className="mt-1 h-3 w-1/2 rounded bg-ink-100" />
        </div>
      </div>
    </div>
  );
}

interface WeeklyReportsListProps {
  weekStart: Date;
  weekEnd: Date;
}

export function WeeklyReportsList({ weekStart, weekEnd }: WeeklyReportsListProps) {
  const { data, error, isLoading } = useSWR<WeekReportsResponse>(
    "/api/reports/weekly-reports/week",
    fetchJson,
    { refreshInterval: 30000 }
  );

  const weekLabel = formatWeekLabel(weekStart, weekEnd);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">加载失败，请刷新页面重试</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-ink-500">
          {weekLabel} 周报列表
        </h4>
        {data && (
          <span className="text-xs text-ink-400">
            共 {data.total} 份
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : data && data.reports.length > 0 ? (
        <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {data.reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50 p-6 text-center">
          <p className="text-sm text-ink-400">本周暂无周报提交</p>
        </div>
      )}
    </div>
  );
}
