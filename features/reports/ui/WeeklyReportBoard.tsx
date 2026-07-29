"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  formatWeekLabel,
  getWeekRangeByOffset,
  getWeekReportTitle,
} from "@/features/weekly-reports/lib/week";
import { fetchJson } from "@/shared/api/fetch-json";
import { WeeklyReportsList } from "./WeeklyReportsList";
import type { WeeklyStats } from "@/features/reports/lib/reports-store";

interface WeekReportUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface WeekBoardResponse {
  reports: unknown[];
  weekStart: string;
  weekEnd: string;
  weekOffset: number;
  submitted: WeekReportUser[];
  missing: WeekReportUser[];
  total: number;
}

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

/** 切换周的下拉：上/下一周 + 直接跳回本周 + 显示当前选中的标题 */
function WeekSwitcher({
  weekOffset,
  weekLabel,
  onChange,
}: {
  weekOffset: number;
  weekLabel: string;
  onChange: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const canGoNext = weekOffset > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600 transition-colors hover:bg-brand-100"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换周"
      >
        <span>{weekLabel}</span>
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-lg border border-ink-200 bg-white p-1 shadow-lg pm-fade-in">
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-ink-500">
            <button
              type="button"
              onClick={() => onChange(weekOffset + 1)}
              className="flex items-center gap-1 rounded px-2 py-1 text-ink-600 transition-colors hover:bg-ink-100"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              上一周
            </button>
            <span className="text-[10px] text-ink-400">{weekLabel}</span>
            <button
              type="button"
              onClick={() => onChange(Math.max(0, weekOffset - 1))}
              disabled={!canGoNext}
              className="flex items-center gap-1 rounded px-2 py-1 text-ink-600 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
            >
              下一周
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="my-1 h-px bg-ink-200" />
          <button
            type="button"
            onClick={() => {
              onChange(0);
              setOpen(false);
            }}
            disabled={weekOffset === 0}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:bg-transparent"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            返回本周
          </button>
        </div>
      )}
    </div>
  );
}

export function WeeklyReportBoard({ weeklyStats }: WeeklyReportBoardProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [listExpanded, setListExpanded] = useState(false);

  // 客户端按 offset 算出目标周的范围
  const { weekStart, weekEnd } = getWeekRangeByOffset(weekOffset);
  const weekLabel = formatWeekLabel(weekStart, weekEnd);
  const reportTitle = getWeekReportTitle(weekStart);

  // 拉取目标周的提交/未提交 + 周报列表
  const { data, isLoading } = useSWR<WeekBoardResponse>(
    `/api/reports/weekly-reports/week?weekOffset=${weekOffset}`,
    fetchJson,
    { refreshInterval: 30000, keepPreviousData: true }
  );

  // 首屏（offset = 0）使用 SSR 数据，避免闪烁；其他周用 SWR 拉到的数据
  const initialUsers = weeklyStats.thisWeekReports;
  const submitted = weekOffset === 0 && !data ? initialUsers.submitted : (data?.submitted ?? initialUsers.submitted);
  const missing   = weekOffset === 0 && !data ? initialUsers.missing   : (data?.missing   ?? initialUsers.missing);
  const total = submitted.length + missing.length;
  const currentRate = total > 0 ? Math.round((submitted.length / total) * 100) : 0;

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      {/* 标题区 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-ink-700">{reportTitle}</h3>
            <WeekSwitcher
              weekOffset={weekOffset}
              weekLabel={weekLabel}
              onChange={setWeekOffset}
            />
            {weekOffset > 0 && (
              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-500">
                历史周
              </span>
            )}
            {isLoading && weekOffset > 0 && (
              <span className="text-[10px] text-ink-400">加载中…</span>
            )}
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
          {weekOffset === 0 && (
            <Link
              href="/reports/weekly-reports"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
            >
              提交周报
            </Link>
          )}
        </div>
      </div>

      {/* 周报列表 - 可折叠 */}
      {listExpanded && (
        <div className="mb-4 rounded-lg border border-ink-200 bg-ink-50 p-3 pm-fade-in">
          <WeeklyReportsList
            weekOffset={weekOffset}
            weekStart={weekStart}
            weekEnd={weekEnd}
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
