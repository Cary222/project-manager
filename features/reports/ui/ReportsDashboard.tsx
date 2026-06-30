"use client";

import Link from "next/link";
import { useState } from "react";
import { formatWeekLabel } from "@/shared/lib/week";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from "recharts";
import type {
  WeeklyTrend,
  MemberContribution,
  WeeklyStats,
  DailyTrend,
  MonthlyTrend,
} from "@/features/reports/lib/reports-store";

interface ReportsDashboardProps {
  weeklyStats: WeeklyStats;
  monthlyStats: WeeklyStats;
  halfYearStats: WeeklyStats;
}

type Period = "week" | "month" | "halfYear";
type Tab = "overview" | "delivery" | "report" | "contribution";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "综合情况" },
  { value: "delivery", label: "交付情况" },
  { value: "report", label: "周报情况" },
  { value: "contribution", label: "贡献情况" },
];

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "halfYear", label: "半年" },
];

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

/** 自定义 Tooltip：显示完整友好信息 */
function CustomTooltip({
  active,
  payload,
  label,
  fullLabel,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: string;
  fullLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-xs font-medium text-ink-700">
        {fullLabel ?? label ?? ""}
      </p>
      {payload.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-1.5 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-ink-500">{entry.name}:</span>
          <span className="font-medium text-ink-700">
            {typeof entry.value === "number" && entry.name?.includes("率") ? `${entry.value}%` : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 将每日数据映射为图表数据（week视图） */
function mapDailyToChart(daily: DailyTrend[]) {
  return daily.map((d) => ({
    label: d.date,
    fullLabel: d.fullLabel,
    done: d.done,
    reportRate: d.reportRate,
    contribution: d.done, // 每日贡献 = 当日实际完成的任务数
  }));
}

/** 将周数据映射为图表数据（week视图：复用） */
function mapWeeklyToChart(weekly: WeeklyTrend[]) {
  return weekly.map((w) => ({
    label: w.week,
    fullLabel: w.week,
    done: w.done,
    reportRate: w.reportRate,
    contribution: 0,
  }));
}

/** 将月数据映射为图表数据（month/halfYear视图） */
function mapMonthlyToChart(monthly: MonthlyTrend[]) {
  return monthly.map((m) => ({
    label: m.month,
    fullLabel: m.month,
    done: m.done,
    reportRate: m.reportRate,
    contribution: m.done, // 月贡献 = 当月实际完成的任务数
  }));
}

export function ReportsDashboard({
  weeklyStats,
  monthlyStats,
  halfYearStats,
}: ReportsDashboardProps) {
  const [period, setPeriod] = useState<Period>("week");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const currentStats = period === "week" ? weeklyStats : period === "month" ? monthlyStats : halfYearStats;
  const currentPeriod = PERIOD_OPTIONS.find((p) => p.value === period);
  const weekLabel = formatWeekLabel(
    new Date(currentStats.thisWeekReports.weekStart),
    new Date(currentStats.thisWeekReports.weekEnd)
  );

  const { submitted, missing } = currentStats.thisWeekReports;
  const total = submitted.length + missing.length;
  const currentRate = total > 0 ? Math.round((submitted.length / total) * 100) : 0;

  // 根据 period 选择图表数据源
  const trendLineData = (() => {
    if (period === "week") {
      // 本周：优先用每日数据（本周7天），不足时用周数据兜底
      if (currentStats.dailyTrend && currentStats.dailyTrend.length > 0) {
        return mapDailyToChart(currentStats.dailyTrend);
      }
      return mapWeeklyToChart(currentStats.weeklyTrend);
    }
    if (period === "month") {
      // 本月：每日数据
      if (currentStats.dailyTrend && currentStats.dailyTrend.length > 0) {
        return mapDailyToChart(currentStats.dailyTrend);
      }
      // 兜底：月数据
      return mapMonthlyToChart(currentStats.monthlyTrend);
    }
    // 半年：月数据
    return mapMonthlyToChart(currentStats.monthlyTrend);
  })();

  // 综合图表数据：任务交付 + 周报率 + 贡献
  // 贡献 = 当日实际完成的任务数（已由 mapDailyToChart/mapMonthlyToChart 正确设置）
  // enrichedTrendData 确保每个数据点都有 contribution 字段（半年度视图需要）
  const totalContribution = trendLineData.reduce((sum, item) => sum + (item.contribution || 0), 0);
  const enrichedTrendData = trendLineData.map((item) => {
    // contribution 已是正确的每日完成数（来自 mapDailyToChart）
    // 或为 0（来自 mapMonthlyToChart 的半年度视图）
    return item;
  });

  // 贡献柱状图数据（取前 8 名成员）
  const contributionBarData = currentStats.contributions
    .slice(0, 8)
    .map((m: MemberContribution) => ({
      name: m.name ?? m.email.split("@")[0],
      done: m.done,
    }));

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft lg:col-span-2">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        {/* Tab 切换 */}
        <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                activeTab === tab.value
                  ? "bg-white text-brand-600 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* 周期切换下拉 */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            <span>{currentPeriod?.label}</span>
            <svg className="h-3 w-3 text-ink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 min-w-[100px] rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setPeriod(opt.value);
                    setDropdownOpen(false);
                  }}
                  className={`flex w-full px-3 py-1.5 text-left text-xs transition-colors ${
                    period === opt.value
                      ? "bg-brand-50 font-medium text-brand-600"
                      : "text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab 内容区域 */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 综合图表：ComposedChart（双折线 + 柱状图叠加） */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-xs text-ink-500">任务交付</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-xs text-ink-500">周报率</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                <span className="text-xs text-ink-500">贡献</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={enrichedTrendData} margin={{ top: 5, right: 30, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                <Tooltip
                  content={<CustomTooltip />}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="contribution"
                  yAxisId="left"
                  fill="#6366f1"
                  name="贡献"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="done"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#3b82f6" }}
                  name="任务交付"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="reportRate"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#f59e0b" }}
                  name="周报率"
                  unit="%"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === "delivery" && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs text-ink-500">任务完成数趋势</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={enrichedTrendData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="done"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 4, fill: "#3b82f6" }}
                name="完成任务数"
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {activeTab === "report" && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs text-ink-500">周报提交率趋势</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={enrichedTrendData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" unit="%" />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="reportRate"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 4, fill: "#f59e0b" }}
                name="周报率"
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {activeTab === "contribution" && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            <span className="text-xs text-ink-500">成员贡献排行</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={contributionBarData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [value, "完成任务数"]}
              />
              <Bar dataKey="done" fill="#6366f1" name="完成任务数" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 本周周报摘要 */}
      <div className="mt-6 border-t border-ink-100 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-400">周报摘要：{weekLabel}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold">{submitted.length}</span>
              <span className="text-sm text-ink-400">/ {total}</span>
              <span className="ml-1 text-xs text-amber-600">({currentRate}%)</span>
            </div>
          </div>
          <Link
            href="/reports/weekly-reports"
            className="rounded-full bg-brand-100 px-3 py-1.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-200"
          >
            去提交
          </Link>
        </div>

        {/* 未提交人员 */}
        {missing.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-red-500">未提交 ({missing.length})</p>
            <div className="flex flex-wrap gap-2">
              {missing.slice(0, 8).map((u) => (
                <Link
                  key={u.id}
                  href={`/team/${u.id}`}
                  className="flex items-center gap-1.5 rounded-lg border border-ink-100 bg-white px-2 py-1 text-xs transition-colors hover:border-red-300 hover:bg-red-50"
                >
                  <Avatar src={u.image} name={u.name} email={u.email} />
                  <span className="text-ink-700">{u.name ?? u.email.split("@")[0]}</span>
                </Link>
              ))}
              {missing.length > 8 && (
                <span className="flex items-center rounded-lg border border-ink-100 bg-ink-50 px-2 py-1 text-xs text-ink-400">
                  +{missing.length - 8}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 已提交人员 */}
        {submitted.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-emerald-600">已提交 ({submitted.length})</p>
            <div className="flex flex-wrap gap-2">
              {submitted.slice(0, 8).map((u) => (
                <Link
                  key={u.id}
                  href={`/team/${u.id}`}
                  className="flex items-center gap-1.5 rounded-lg border border-ink-100 bg-white px-2 py-1 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50"
                >
                  <Avatar src={u.image} name={u.name} email={u.email} />
                  <span className="text-ink-700">{u.name ?? u.email.split("@")[0]}</span>
                </Link>
              ))}
              {submitted.length > 8 && (
                <span className="flex items-center rounded-lg border border-ink-100 bg-ink-50 px-2 py-1 text-xs text-ink-400">
                  +{submitted.length - 8}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
