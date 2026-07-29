"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetchJson } from "@/shared/api/fetch-json";
import { MonthlyExpenseList } from "@/features/reports/monthly-expenses/ui/MonthlyExpenseList";
import type { MonthlyExpenseWithUser } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";

interface ExpenseSummary {
  type: string;
  label: string;
  count: number;
  total: number;
}

interface ExpenseUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface MonthlyStatsResponse {
  month: string;
  expenses: {
    id: string;
    amount: number;
    expenseType: string;
    description: string;
    createdAt: string;
    user: ExpenseUser;
  }[];
  summary: {
    total: number;
    count: number;
    byType: ExpenseSummary[];
  };
}

function formatAmount(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  TRANSPORT: { bg: "bg-blue-100", text: "text-blue-700" },
  MEAL: { bg: "bg-orange-100", text: "text-orange-700" },
  TRAVEL: { bg: "bg-purple-100", text: "text-purple-700" },
  OFFICE: { bg: "bg-green-100", text: "text-green-700" },
  OTHER: { bg: "bg-gray-100", text: "text-gray-700" },
};

function MonthSwitcher({
  month,
  onChange,
}: {
  month: string;
  onChange: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);

  function parseYearMonth(m: string): { year: number; month: number } {
    const [y, mo] = m.split("-").map(Number);
    return { year: y!, month: mo! };
  }

  function formatMonthLabel(m: string): string {
    const { year, month: mo } = parseYearMonth(m);
    return `${year}年${mo}月`;
  }

  function toPrevMonth(m: string): string {
    const { year, month: mo } = parseYearMonth(m);
    if (mo === 1) return `${year - 1}-12`;
    return `${year}-${String(mo - 1).padStart(2, "0")}`;
  }

  function toNextMonth(m: string): string {
    const { year, month: mo } = parseYearMonth(m);
    if (mo === 12) return `${year + 1}-01`;
    return `${year}-${String(mo + 1).padStart(2, "0")}`;
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const canGoNext = month < currentMonth;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600 transition-colors hover:bg-brand-100"
      >
        <span>{formatMonthLabel(month)}</span>
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-48 rounded-lg border border-ink-200 bg-white p-1 shadow-lg pm-fade-in">
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-ink-500">
            <button
              type="button"
              onClick={() => { onChange(toPrevMonth(month)); setOpen(false); }}
              className="flex items-center gap-1 rounded px-2 py-1 text-ink-600 transition-colors hover:bg-ink-100"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              上月
            </button>
            <span className="text-[10px] text-ink-400">{formatMonthLabel(month)}</span>
            <button
              type="button"
              onClick={() => { onChange(toNextMonth(month)); setOpen(false); }}
              disabled={!canGoNext}
              className="flex items-center gap-1 rounded px-2 py-1 text-ink-600 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent"
            >
              下月
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="my-1 h-px bg-ink-200" />
          <button
            type="button"
            onClick={() => { onChange(currentMonth); setOpen(false); }}
            disabled={month === currentMonth}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:text-ink-400 disabled:hover:bg-transparent"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            返回本月
          </button>
        </div>
      )}
    </div>
  );
}

export function MonthlyExpenseBoard() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentMonth);
  const [listExpanded, setListExpanded] = useState(false);

  const { data, isLoading } = useSWR<MonthlyStatsResponse & { expenses?: MonthlyExpenseWithUser[] }>(
    `/api/reports/monthly-expenses/stats?month=${month}`,
    fetchJson,
    { refreshInterval: 30000, keepPreviousData: true },
  );

  const summary = data?.summary;
  const total = summary?.total ?? 0;
  const count = summary?.count ?? 0;
  const byType = summary?.byType ?? [];
  const expenses = data?.expenses ?? [];

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      {/* 标题区 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-ink-700">月度报销</h3>
            <MonthSwitcher month={month} onChange={setMonth} />
            {month < currentMonth && (
              <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-500">
                历史月份
              </span>
            )}
            {isLoading && month !== currentMonth && (
              <span className="text-[10px] text-ink-400">加载中…</span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-ink-900">{formatAmount(total)}</span>
            <span className="text-lg text-ink-400">{count} 笔</span>
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
            {listExpanded ? "收起" : "查看月报"}
          </button>
          <Link
            href="/reports/monthly-expenses/new"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
          >
            新建报销
          </Link>
        </div>
      </div>

      {/* 月度报销列表 - 可折叠 */}
      {listExpanded && (
        <div className="mb-4 rounded-lg border border-ink-200 bg-ink-50 p-3 pm-fade-in">
          <MonthlyExpenseList initialExpenses={expenses} />
        </div>
      )}

      {/* 类型分布 */}
      {byType.length > 0 ? (
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="mb-2 text-xs text-ink-500">报销类型分布</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {byType.map((item) => {
              const colors = TYPE_COLORS[item.type] ?? { bg: "bg-gray-100", text: "text-gray-700" };
              return (
                <div
                  key={item.type}
                  className={`rounded-lg ${colors.bg} p-2.5`}
                >
                  <div className={`text-xs font-medium ${colors.text}`}>{item.label}</div>
                  <div className={`text-lg font-bold ${colors.text}`}>
                    {formatAmount(item.total)}
                  </div>
                  <div className={`text-xs ${colors.text} opacity-75`}>{item.count} 笔</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-ink-200 bg-ink-50 p-6 text-center">
          <p className="text-sm text-ink-500">本月暂无报销记录</p>
        </div>
      )}
    </section>
  );
}
