"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
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

type ProjectHealthDetail = {
  id: string;
  name: string;
  progress: number;
  status: "good" | "normal" | "attention" | "risk";
};

const STATUS_TONE: Record<ProjectHealthDetail["status"], string> = {
  good:      "bg-emerald-500",
  normal:    "bg-brand-500",
  attention: "bg-amber-500",
  risk:      "bg-red-500",
};

const STATUS_LABEL: Record<ProjectHealthDetail["status"], string> = {
  good:      "良好",
  normal:    "正常",
  attention: "关注",
  risk:      "风险",
};
import { fetchJson } from "@/shared/api/fetch-json";

type Period = "week" | "month" | "halfYear";
type Tab = "overview" | "delivery" | "report" | "contribution" | "expense" | "project";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "综合情况" },
  { value: "project", label: "项目情况" },
  { value: "delivery", label: "交付情况" },
  { value: "report", label: "周报情况" },
  { value: "contribution", label: "贡献情况" },
  { value: "expense", label: "报销情况" },
];

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "halfYear", label: "半年" },
];

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

/** 将每日数据映射为图表数据 */
function mapDailyToChart(daily: DailyTrend[]) {
  return daily.map((d) => ({
    label: d.date,
    fullLabel: d.fullLabel,
    done: d.done,
    reportRate: d.reportRate,
    contribution: d.done,
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
    contribution: m.done,
  }));
}

export function ReportsDashboard({
  weeklyStats,
  monthlyStats,
  halfYearStats,
  projectHealth,
}: {
  weeklyStats: WeeklyStats;
  monthlyStats: WeeklyStats;
  halfYearStats: WeeklyStats;
  projectHealth: ProjectHealthDetail[];
}) {
  const [period, setPeriod] = useState<Period>("week");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const currentStats = period === "week" ? weeklyStats : period === "month" ? monthlyStats : halfYearStats;
  const currentPeriod = PERIOD_OPTIONS.find((p) => p.value === period);

  const { submitted, missing } = currentStats.thisWeekReports;
  const total = submitted.length + missing.length;

  // 根据 period 选择图表数据源
  const trendLineData = (() => {
    if (period === "week") {
      // 本周：优先用每日数据，图表最后一天显示本周整体周报率
      if (currentStats.dailyTrend && currentStats.dailyTrend.length > 0) {
        return mapDailyToChart(currentStats.dailyTrend).map((d, i, arr) =>
          i === arr.length - 1 ? { ...d, reportRate: submitted.length > 0 ? Math.round((submitted.length / total) * 100) : d.reportRate } : d
        );
      }
      return mapWeeklyToChart(currentStats.weeklyTrend);
    }
    if (period === "month") {
      // 本月：每日数据，后端按周分段独立计算周报率
      if (currentStats.dailyTrend && currentStats.dailyTrend.length > 0) {
        return mapDailyToChart(currentStats.dailyTrend);
      }
      return mapMonthlyToChart(currentStats.monthlyTrend);
    }
    // 半年：月数据
    return mapMonthlyToChart(currentStats.monthlyTrend);
  })();

  const enrichedTrendData = trendLineData.map((item) => item);

  // 贡献柱状图数据（取前 8 名成员）
  const contributionBarData = currentStats.contributions
    .slice(0, 8)
    .map((m: MemberContribution) => ({
      name: m.name ?? m.email.split("@")[0],
      done: m.done,
    }));

  return (
    <section className="flex h-full flex-col rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
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
                <Tooltip content={<CustomTooltip />} />
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

      {activeTab === "expense" && <ExpenseTabContent period={period} />}

      {activeTab === "project" && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand-500" />
            <span className="text-xs text-ink-500">项目进度一览</span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={projectHealth}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#9ca3af" unit="%" />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10 }}
                stroke="#9ca3af"
                width={80}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any) => [`${value}%`, "进度"]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(label: any) => String(label)}
              />
              <Bar
                dataKey="progress"
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
              >
                {projectHealth.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.status === "good" ? "#10b981" :
                      entry.status === "normal" ? "#3b82f6" :
                      entry.status === "attention" ? "#f59e0b" :
                      "#ef4444"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

interface ExpenseStatsResponse {
  month: string;
  summary: {
    total: number;
    count: number;
    byType: { type: string; label: string; count: number; total: number }[];
  };
}

const PIE_COLORS = ["#3b82f6", "#f59e0b", "#8b5cf6", "#10b981", "#6b7280"];

function formatExpenseAmount(amount: number): string {
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ExpenseTabContent({ period }: { period: Period }) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month =
    period === "week"
      ? currentMonth
      : period === "month"
        ? currentMonth
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const { data, isLoading } = useSWR<ExpenseStatsResponse>(
    `/api/reports/monthly-expenses/stats?month=${month}`,
    fetchJson,
    { refreshInterval: 30000, keepPreviousData: true },
  );

  const summary = data?.summary;
  const byType = summary?.byType ?? [];

  const pieData = byType
    .filter((t) => t.total > 0)
    .map((t) => ({ name: t.label, value: Math.round(t.total * 100) / 100 }));

  return (
    <div>
      {isLoading ? (
        <div className="flex h-[300px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        </div>
      ) : summary && summary.count > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* 饼图 */}
          <div>
            <p className="mb-2 text-xs text-ink-500">报销类型分布</p>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: "#9ca3af", strokeWidth: 1 }}
                >
                  {pieData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any) => [formatExpenseAmount(Number(value)), "金额"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* 明细表格 */}
          <div>
            <p className="mb-2 text-xs text-ink-500">报销明细</p>
            <div className="rounded-lg border border-ink-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-ink-50">
                    <th className="px-3 py-2 text-left font-medium text-ink-600">类型</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-600">笔数</th>
                    <th className="px-3 py-2 text-right font-medium text-ink-600">金额</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((t, i) => (
                    <tr key={t.type} className={i % 2 === 0 ? "bg-white" : "bg-ink-50/50"}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: PIE_COLORS[byType.indexOf(t) % PIE_COLORS.length] }}
                          />
                          <span className="text-ink-700">{t.label}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-600">{t.count}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink-900">
                        {formatExpenseAmount(t.total)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-ink-200 bg-brand-50 font-semibold">
                    <td className="px-3 py-2 text-ink-700">合计</td>
                    <td className="px-3 py-2 text-right text-ink-700">{summary.count}</td>
                    <td className="px-3 py-2 text-right text-brand-700">{formatExpenseAmount(summary.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 bg-ink-50 text-center">
          <svg className="h-10 w-10 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-2 text-sm text-ink-500">本月暂无报销记录</p>
        </div>
      )}
    </div>
  );
}
