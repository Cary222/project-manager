"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekLabel } from "@/shared/lib/week";
import { WeeklyReportsList } from "./WeeklyReportsList";
import type { WeeklyStats } from "@/features/reports/lib/reports-store";

function Avatar({ src, name, email }: { src: string | null; name: string | null; email: string }) {
  const initial = (name ?? email).slice(0, 1).toUpperCase();
  return src ? (
    <img src={src} alt={name ?? email} className="h-6 w-6 rounded-full border border-white object-cover" />
  ) : (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white bg-brand-100 text-xs font-medium text-brand-600">
      {initial}
    </div>
  );
}

interface WeeklyReportBoardProps {
  weeklyStats: WeeklyStats;
}

export function WeeklyReportBoard({ weeklyStats }: WeeklyReportBoardProps) {
  const [listExpanded, setListExpanded] = useState(false);
  const { submitted, missing } = weeklyStats.thisWeekReports;
  const total = submitted.length + missing.length;
  const currentRate = total > 0 ? Math.round((submitted.length / total) * 100) : 0;
  const weekLabel = formatWeekLabel(
    new Date(weeklyStats.thisWeekReports.weekStart),
    new Date(weeklyStats.thisWeekReports.weekEnd)
  );

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      {/* 标题区 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-ink-700">本周周报</h3>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
              {weekLabel}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-ink-900">{submitted.length}</span>
            <span className="text-lg text-ink-400">/ {total}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              currentRate >= 80 ? "bg-emerald-100 text-emerald-700" :
              currentRate >= 50 ? "bg-amber-100 text-amber-700" :
              "bg-red-100 text-red-700"
            }`}>
              {currentRate}%
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setListExpanded(!listExpanded)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={listExpanded ? "M19 9l-7 7-7-7" : "M9 5l7 7-7 7"} />
            </svg>
            {listExpanded ? "收起" : "查看周报"}
          </button>
          <Link
            href="/reports/weekly-reports"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
          >
            提交周报
          </Link>
        </div>
      </div>

      {/* 周报列表 - 可折叠 */}
      {listExpanded && (
        <div className="mb-4 rounded-lg border border-ink-200 bg-ink-50 p-3 pm-fade-in">
          <WeeklyReportsList
            weekStart={new Date(weeklyStats.thisWeekReports.weekStart)}
            weekEnd={new Date(weeklyStats.thisWeekReports.weekEnd)}
          />
        </div>
      )}

      {/* 未提交人员 */}
      {missing.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="mb-2 flex items-center gap-2 text-xs text-red-500">
            <svg className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            未提交 ({missing.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {missing.map((u) => (
              <Link
                key={u.id}
                href={`/team/${u.id}`}
                className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs transition-colors hover:border-red-300 hover:bg-red-50"
              >
                <Avatar src={u.image} name={u.name} email={u.email} />
                <span className="text-ink-700">{u.name ?? u.email.split("@")[0]}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 已提交人员 */}
      {submitted.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="mb-2 flex items-center gap-2 text-xs text-emerald-600">
            <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            已提交 ({submitted.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {submitted.map((u) => (
              <Link
                key={u.id}
                href={`/team/${u.id}`}
                className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50"
              >
                <Avatar src={u.image} name={u.name} email={u.email} />
                <span className="text-ink-700">{u.name ?? u.email.split("@")[0]}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
