"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppShell } from "@/shared/ui/AppShell";
import {
  IconClock,
  IconKnowledge,
  IconMic,
  IconProject,
  IconTask,
  IconTrend,
} from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import {
  useRecentVisits,
  useFrequentVisits,
} from "@/shared/lib/visits-context";
import {
  type MyTicket,
  STATUS_LABEL,
  STATUS_ORDER,
} from "@/entities/ticket/model/types";
import { formatWeekLabel, getWeekRangeByOffset } from "@/features/weekly-reports/lib/week";
import { PriorityBadge } from "@/shared/ui/PriorityBadge";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

type Note = {
  id: string;
  title: string;
  updatedAt: string;
  project: { id: string; name: string } | null;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
};

type WeekReportResponse = {
  reports: unknown[];
  weekStart: string;
  weekEnd: string;
  submitted: { id: string; name: string | null }[];
  missing: { id: string; name: string | null }[];
  total: number;
};

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "凌晨好";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function PreviewCard({
  title,
  icon,
  href,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition-shadow duration-150 hover:shadow lg:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            {icon}
          </span>
          <h3 className="text-sm font-medium text-ink-900">{title}</h3>
        </div>
        <Link
          href={href}
          className="text-xs font-medium text-brand-600 transition-colors duration-200 hover:text-brand-700"
        >
          查看全部
        </Link>
      </div>
      {children}
    </div>
  );
}

export function Dashboard() {
  const { data: session } = useSession();
  const { visits } = useRecentVisits();
  const { frequent } = useFrequentVisits();
  const [visitTab, setVisitTab] = useState<"recent" | "frequent">("recent");

  const {
    data: projectsData,
    error: projectsError,
    isLoading: projectsLoading,
  } = useSWR<{ projects: Project[] }>(
    "/api/projects",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const {
    data: myTicketsData,
    isLoading: myTicketsLoading,
  } = useSWR<{ tickets: MyTicket[] }>(
    "/api/tickets/mine",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const {
    data: notesData,
    isLoading: notesLoading,
  } = useSWR<{ notes: Note[] }>(
    "/api/pkm/notes?take=3",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const { weekStart, weekEnd } = getWeekRangeByOffset(0);
  const {
    data: weeklyData,
    isLoading: weeklyLoading,
  } = useSWR<WeekReportResponse>(
    `/api/reports/weekly-reports/week?weekOffset=0`,
    fetchJson,
    { ...STALE_SWR_OPTIONS, refreshInterval: 60000 }
  );

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
  } = useSWR<{ data: Conversation[] }>(
    "/api/ai/conversations?limit=3",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  // 月度报销汇总
  const currentMonth = new Date().toISOString().slice(0, 7);
  const {
    data: monthlyExpensesData,
  } = useSWR<{ expenses: { amount: number }[] }>(
    `/api/reports/monthly-expenses?month=${currentMonth}`,
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const monthlyTotal = monthlyExpensesData?.expenses?.reduce((sum, e) => sum + e.amount, 0) ?? 0;

  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const myTickets = useMemo(() => myTicketsData?.tickets ?? [], [myTicketsData]);
  const notes = useMemo(() => notesData?.notes ?? [], [notesData]);
  const conversations = useMemo(
    () => conversationsData?.data ?? [],
    [conversationsData]
  );

  const ticketCounts = useMemo(() => {
    const developing = myTickets.filter((t) => t.status === "DEVELOPING").length;
    const test = myTickets.filter((t) => t.status === "READY_FOR_TEST").length;
    const delivered = myTickets.filter((t) => t.status === "DELIVERED").length;
    const done = myTickets.filter((t) => t.status === "DONE").length;
    const p0p1 = myTickets.filter(
      (t) => t.priority <= 1 && !["DONE", "CLOSED"].includes(t.status)
    ).length;
    return {
      myTickets: myTickets.length,
      developing,
      test,
      delivered,
      done,
      pending: developing + test + delivered,
      p0p1,
    };
  }, [myTickets]);

  const weeklySubmitted = weeklyData?.submitted.some(
    (u) => u.id === session?.user?.id || u.name === session?.user?.name
  ) ?? false;

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">工作台</h1>
          <p className="text-xs text-ink-400">Dashboard · 专注交付，用知识驱动成长</p>
        </div>
      }
    >
      <div className="space-y-6 pm-fade-in">
        {/* 欢迎栏 + 访问历史 */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* 欢迎栏 */}
          <div className="rounded-xl border border-ink-200 bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-sm lg:col-span-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-semibold text-white">
                  {greeting()}，{session?.user?.name || "同学"}
                </p>
                <p className="mt-2 text-sm text-brand-100">
                  你有{" "}
                  <span className="font-semibold text-white">
                    {ticketCounts.pending}
                  </span>{" "}
                  个任务待推进，当前负责{" "}
                  <span className="font-semibold text-white">
                    {projects.length}
                  </span>{" "}
                  个项目。
                </p>
                {ticketCounts.p0p1 > 0 && (
                  <Link
                    href="/tasks?priority=0,1"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500/30"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    {ticketCounts.p0p1} 个 P0/P1 任务待处理
                  </Link>
                )}
              </div>
              <div className="hidden text-right lg:block">
                <p className="text-4xl font-bold text-white">
                  {ticketCounts.pending}
                </p>
                <p className="text-xs text-brand-200">待推进</p>
              </div>
            </div>
          </div>

          {/* 访问历史 */}
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-4">
                <button
                  onClick={() => setVisitTab("recent")}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors duration-200 ${
                    visitTab === "recent"
                      ? "text-brand-600"
                      : "text-ink-400 hover:text-ink-600"
                  }`}
                >
                  <IconClock className="h-4 w-4" />
                  最近
                </button>
                <button
                  onClick={() => setVisitTab("frequent")}
                  className={`flex items-center gap-1.5 text-sm font-medium transition-colors duration-200 ${
                    visitTab === "frequent"
                      ? "text-brand-600"
                      : "text-ink-400 hover:text-ink-600"
                  }`}
                >
                  <IconTrend className="h-4 w-4" />
                  经常
                </button>
              </div>
            </div>
            {visitTab === "recent" ? (
              visits.length === 0 ? (
                <p className="text-xs text-ink-400">暂无访问记录</p>
              ) : (
                <ul className="space-y-1.5">
                  {visits.slice(0, 4).map((v, i) => (
                    <li key={`${v.projectId}-${v.tabKey}-${v.ticketId ?? ""}`}>
                      <Link
                        href={
                          v.tabKey === "note"
                            ? `/pkm/notes/${v.ticketId}`
                            : v.ticketId
                            ? `/tickets/${v.ticketId}`
                            : `/projects/${v.projectId}?tab=${v.tabKey}`
                        }
                        className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/40 px-2.5 py-2 text-xs transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-ink-700">
                          {v.ticketNo
                            ? `#${v.ticketNo} `
                            : ""}
                          {v.ticketId
                            ? v.ticketTitle ?? v.projectName
                            : v.projectName}
                        </span>
                        <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">
                          {v.tabKey === "note"
                            ? "笔记"
                            : v.tabKey === "ticket"
                            ? "单子"
                            : v.tabLabel}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : frequent.length === 0 ? (
              <p className="text-xs text-ink-400">暂无经常访问的页面</p>
            ) : (
              <ul className="space-y-1.5">
                {frequent.slice(0, 4).map((f, i) => (
                  <li key={`${f.projectId}-${f.tabKey}-${f.ticketId ?? ""}`}>
                    <Link
                      href={
                        f.tabKey === "note"
                          ? `/pkm/notes/${f.ticketId}`
                          : f.ticketId
                          ? `/tickets/${f.ticketId}`
                          : `/projects/${f.projectId}?tab=${f.tabKey}`
                      }
                      className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/40 px-2.5 py-2 text-xs transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink-700">
                        {f.ticketNo ? `#${f.ticketNo} ` : ""}
                        {f.ticketId
                          ? f.ticketTitle ?? f.projectName
                          : f.projectName}
                      </span>
                      <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">
                        {f.tabKey === "note"
                          ? "笔记"
                          : f.tabKey === "ticket"
                          ? "单子"
                          : f.tabLabel}
                      </span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        {f.count}次
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 实用预览区：笔记 / 周报 / AI 对话 */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* 最近笔记 */}
          <PreviewCard
            title="最近笔记"
            icon={<IconKnowledge className="h-4 w-4" />}
            href="/pkm/notes"
          >
            {notesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-ink-100"
                  />
                ))}
              </div>
            ) : notes.length === 0 ? (
              <p className="text-xs text-ink-400">暂无笔记</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((note) => (
                  <li key={note.id}>
                    <Link
                      href={`/pkm/notes/${note.id}`}
                      className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-ink-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink-700">
                          {note.title}
                        </p>
                        <p className="text-xs text-ink-400">
                          {note.project?.name ?? "个人笔记"}
                        </p>
                      </div>
                      <span className="ml-2 shrink-0 text-xs text-ink-400">
                        {timeAgo(note.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PreviewCard>

          {/* 报表区域：周报 + 报销 */}
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition-all duration-200 hover:border-ink-300 hover:shadow lg:p-5">
            {/* 周报区域 */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                  <IconTask className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-semibold text-ink-900">周报</h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/reports/weekly-reports"
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-100"
                >
                  查看周报
                </Link>
                {!weeklySubmitted && (
                  <Link
                    href="/reports/weekly-reports/new"
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
                  >
                    立即提交
                  </Link>
                )}
              </div>
            </div>
            {weeklyLoading ? (
              <div className="h-10 animate-pulse rounded-lg bg-ink-100" />
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2.5">
                <span
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                    weeklySubmitted
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-amber-100 text-amber-600"
                  }`}
                >
                  {weeklySubmitted ? "✓" : "!"}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-ink-700">
                    {weeklySubmitted ? "已提交本周周报" : "请提交本周周报"}
                  </span>
                  <span className="text-xs text-ink-400">{formatWeekLabel(weekStart, weekEnd)}</span>
                </div>
              </div>
            )}

            {/* 分隔线 */}
            <div className="my-4 border-t border-ink-100" />

            {/* 报销区域 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                  <span className="text-sm font-semibold">¥</span>
                </span>
                <h3 className="text-sm font-semibold text-ink-900">报销</h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/reports/monthly-expenses"
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-100"
                >
                  查看报销
                </Link>
                <Link
                  href="/reports/monthly-expenses/new"
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
                >
                  立即提交
                </Link>
              </div>
            </div>
            {monthlyTotal > 0 ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2.5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600">
                  ¥
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-ink-700">本月报销</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-400">{currentMonth}</span>
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                      ¥{monthlyTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2.5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm text-ink-400">
                  ¥
                </span>
                <div className="flex flex-col">
                  <span className="text-sm text-ink-400">暂无报销记录</span>
                  <span className="text-xs text-ink-400">{currentMonth}</span>
                </div>
              </div>
            )}
          </div>

          {/* AI 对话最近问题 */}
          <PreviewCard
            title="AI 对话"
            icon={<IconMic className="h-4 w-4" />}
            href="/ai"
          >
            {conversationsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-ink-100"
                  />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <p className="text-xs text-ink-400">暂无对话</p>
            ) : (
              <ul className="space-y-2">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <Link
                      href={`/ai/conversations/${conv.id}`}
                      className="flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-ink-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink-700">
                          {conv.title || "无标题对话"}
                        </p>
                        <p className="text-xs text-ink-400">
                          {conv.messageCount} 条消息
                        </p>
                      </div>
                      <span className="ml-2 shrink-0 text-xs text-ink-400">
                        {timeAgo(conv.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </PreviewCard>
        </section>

        {/* 我可见的项目 */}
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-900">我可见的项目</h2>
            <Link
              href="/projects"
              className="text-sm font-medium text-brand-600 transition-colors duration-200 hover:text-brand-700"
            >
              查看全部
            </Link>
          </div>
          {projectsError ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-6 text-center text-sm text-danger">
              项目数据加载失败，请稍后刷新页面。
            </div>
          ) : projectsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-3"
                >
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-ink-200" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-40 animate-pulse rounded bg-ink-200" />
                    <div className="h-3 w-56 animate-pulse rounded bg-ink-100" />
                  </div>
                  <div className="h-6 w-16 animate-pulse rounded-full bg-ink-100" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
              <div className="rounded-full bg-ink-100 p-3 text-ink-400">
                <IconProject className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-ink-900">
                还没有项目
              </h3>
              <p className="mt-1 text-sm text-ink-500">
                创建一个项目开始协作
              </p>
              <Link
                href="/projects/new"
                className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-200 hover:bg-brand-700"
              >
                新建项目
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {projects.slice(0, 5).map((p, i) => {
                const tone = [
                  "bg-brand-500",
                  "bg-success",
                  "bg-warning",
                  "bg-purple",
                  "bg-danger",
                ][i % 5];
                const projectVisits = visits.filter(
                  (v) => v.projectId === p.id
                );
                return (
                  <li key={p.id} className="group relative">
                    <Link
                      href={`/projects/${p.id}`}
                      aria-label={`打开项目 ${p.name}`}
                      className="absolute inset-0 z-10 rounded-lg"
                    />
                    <div className="flex items-center gap-3 rounded-lg border border-ink-100 bg-white px-3 py-3 transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50/40">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {p.name}
                        </p>
                        {p.description ? (
                          <p className="truncate text-xs text-ink-400">
                            {p.description}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-500">
                        {p.status === "ACTIVE" ? "进行中" : p.status}
                      </span>
                    </div>
                    {projectVisits.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {projectVisits.map((v, vi) => (
                          <Link
                            key={`${v.projectId}-${v.tabKey}-${
                              v.ticketId ?? "tab"
                            }-${vi}`}
                            href={
                              v.tabKey === "note"
                                ? `/pkm/notes/${v.ticketId}`
                                : v.ticketId
                                ? `/tickets/${v.ticketId}`
                                : `/projects/${v.projectId}?tab=${v.tabKey}`
                            }
                            className="relative z-20 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 transition-colors duration-200 hover:bg-brand-100"
                          >
                            {v.ticketNo
                              ? `#${v.ticketNo}`
                              : v.tabKey === "note"
                              ? "笔记"
                              : v.tabLabel}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
