"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppShell } from "@/shared/ui/AppShell";
import {
  IconClock,
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
  type TicketStatus,
  type MyTicket,
  STATUS_LABEL,
  STATUS_ORDER,
} from "@/entities/ticket/model/types";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

const STATUS_STYLE: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-50 text-brand-700",
  READY_FOR_TEST: "bg-amber-50 text-amber-600",
  DELIVERED: "bg-violet-50 text-violet-700",
  DONE: "bg-emerald-50 text-emerald-600",
  OVERDUE: "bg-red-50 text-red-600",
  CLOSED: "bg-ink-100 text-ink-500",
};

const STATUS_DOT: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-500",
  READY_FOR_TEST: "bg-warning",
  DELIVERED: "bg-purple",
  DONE: "bg-success",
  OVERDUE: "bg-danger",
  CLOSED: "bg-ink-400",
};

const KIND_LABEL: Record<"PROGRAM" | "DESIGN", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

function sortMyTickets(tickets: MyTicket[]) {
  return [...tickets].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.ticketNo - a.ticketNo;
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "凌晨好";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function StatCard({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone: "brand" | "amber" | "danger" | "purple";
  icon: React.ReactNode;
}) {
  const toneMap = {
    brand: "bg-brand-50 text-brand-700",
    amber: "bg-amber-50 text-warning",
    danger: "bg-red-50 text-danger",
    purple: "bg-violet-50 text-purple",
  } as const;
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition-shadow duration-150 hover:shadow lg:p-6">
      <div className="flex items-start justify-between">
        <p className="text-sm text-ink-500">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneMap[tone]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
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
    error: myTicketsError,
    isLoading: myTicketsLoading,
  } = useSWR<{ tickets: MyTicket[] }>(
    "/api/tickets/mine",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const projects = useMemo(() => projectsData?.projects ?? [], [projectsData]);
  const myTickets = useMemo(() => myTicketsData?.tickets ?? [], [myTicketsData]);

  const projectCounts = useMemo(
    () => ({
      projects: projects.length,
    }),
    [projects]
  );

  const ticketCounts = useMemo(() => {
    const developing = myTickets.filter((t) => t.status === "DEVELOPING").length;
    const test = myTickets.filter((t) => t.status === "READY_FOR_TEST").length;
    const delivered = myTickets.filter((t) => t.status === "DELIVERED").length;
    const done = myTickets.filter((t) => t.status === "DONE").length;
    return {
      myTickets: myTickets.length,
      developing,
      test,
      delivered,
      done,
      pending: developing + test + delivered,
    };
  }, [myTickets]);

  const sortedTickets = useMemo(() => sortMyTickets(myTickets), [myTickets]);
  const total = ticketCounts.myTickets || 1;
  const dist: { key: TicketStatus; label: string; count: number; pct: number }[] = [
    {
      key: "DEVELOPING",
      label: "开发中",
      count: ticketCounts.developing,
      pct: Math.round((ticketCounts.developing / total) * 100),
    },
    {
      key: "READY_FOR_TEST",
      label: "待测试",
      count: ticketCounts.test,
      pct: Math.round((ticketCounts.test / total) * 100),
    },
    {
      key: "DELIVERED",
      label: "已交付",
      count: ticketCounts.delivered,
      pct: Math.round((ticketCounts.delivered / total) * 100),
    },
    {
      key: "DONE",
      label: "已完成",
      count: ticketCounts.done,
      pct: Math.round((ticketCounts.done / total) * 100),
    },
  ];

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
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-ink-200 bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-sm lg:col-span-2">
            <p className="text-2xl font-semibold text-white">
              {greeting()}，{session?.user?.name || "同学"}
            </p>
            <p className="mt-2 text-sm text-brand-100">
              你有 <span className="font-semibold text-white">{ticketCounts.pending}</span> 个任务待推进，
              当前负责 <span className="font-semibold text-white">{projectCounts.projects}</span> 个项目。
            </p>
          </div>

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
                        href={v.tabKey === "note" ? `/pkm/notes/${v.ticketId}` : v.ticketId ? `/tickets/${v.ticketId}` : `/projects/${v.projectId}?tab=${v.tabKey}`}
                        className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/40 px-2.5 py-2 text-xs transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-ink-700">
                          {v.ticketNo ? `#${v.ticketNo} ` : ""}{v.ticketId ? v.ticketTitle ?? v.projectName : v.projectName}
                        </span>
                        <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">
                          {v.tabKey === "note" ? "笔记" : v.tabKey === "ticket" ? "单子" : v.tabLabel}
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
                      href={f.tabKey === "note" ? `/pkm/notes/${f.ticketId}` : f.ticketId ? `/tickets/${f.ticketId}` : `/projects/${f.projectId}?tab=${f.tabKey}`}
                      className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/40 px-2.5 py-2 text-xs transition-colors duration-200 hover:border-brand-200 hover:bg-brand-50"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink-700">
                        {f.ticketNo ? `#${f.ticketNo} ` : ""}{f.ticketId ? f.ticketTitle ?? f.projectName : f.projectName}
                      </span>
                      <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] text-brand-700">
                        {f.tabKey === "note" ? "笔记" : f.tabKey === "ticket" ? "单子" : f.tabLabel}
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

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="项目数"
            value={projectsLoading ? "—" : projectCounts.projects}
            hint="我可见的项目"
            tone="brand"
            icon={<IconProject className="h-5 w-5" />}
          />
          <StatCard
            label="我的任务"
            value={myTicketsLoading ? "—" : ticketCounts.myTickets}
            hint={`进行中 ${ticketCounts.developing} · 待测试 ${ticketCounts.test} · 已交付 ${ticketCounts.delivered}`}
            tone="purple"
            icon={<IconTask className="h-5 w-5" />}
          />
          <StatCard
            label="待处理"
            value={myTicketsLoading ? "—" : ticketCounts.pending}
            hint="及时处理，避免堆积"
            tone="danger"
            icon={<IconClock className="h-5 w-5" />}
          />
          <StatCard
            label="已完成"
            value={myTicketsLoading ? "—" : ticketCounts.done}
            hint="累计完成任务"
            tone="amber"
            icon={<IconTask className="h-5 w-5" />}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm lg:col-span-2">
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
                <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有项目</h3>
                <p className="mt-1 text-sm text-ink-500">创建一个项目开始协作</p>
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
                  const projectVisits = visits.filter((v) => v.projectId === p.id);
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
                          <p className="truncate text-sm font-medium text-ink-900">{p.name}</p>
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
                              key={`${v.projectId}-${v.tabKey}-${v.ticketId ?? "tab"}-${vi}`}
                              href={v.tabKey === "note" ? `/pkm/notes/${v.ticketId}` : v.ticketId ? `/tickets/${v.ticketId}` : `/projects/${v.projectId}?tab=${v.tabKey}`}
                              className="relative z-20 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 transition-colors duration-200 hover:bg-brand-100"
                            >
                              {v.ticketNo ? `#${v.ticketNo}` : v.tabKey === "note" ? "笔记" : v.tabLabel}
                            </Link>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-medium text-ink-900">任务状态分布</h2>
            {myTicketsError ? (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-6 text-center text-sm text-danger">
                任务数据加载失败，请稍后刷新页面。
              </div>
            ) : myTicketsLoading ? (
              <div>
                <div className="mb-4 flex items-center justify-center">
                  <div className="h-28 w-28 animate-pulse rounded-full bg-ink-100" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-ink-200" />
                        <div className="h-4 w-16 animate-pulse rounded bg-ink-100" />
                      </div>
                      <div className="h-4 w-6 animate-pulse rounded bg-ink-100" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-center">
                  <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-ink-100">
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: `conic-gradient(var(--color-brand-500) 0% ${dist[0].pct}%, var(--color-warning) ${dist[0].pct}% ${
                          dist[0].pct + dist[1].pct
                        }%, var(--color-purple) ${dist[0].pct + dist[1].pct}% ${
                          dist[0].pct + dist[1].pct + dist[2].pct
                        }%, var(--color-success) ${
                          dist[0].pct + dist[1].pct + dist[2].pct
                        }% 100%)`,
                      }}
                    />
                    <div className="relative flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white">
                      <span className="text-xl font-semibold text-ink-900">{ticketCounts.myTickets}</span>
                      <span className="text-xs text-ink-400">总数</span>
                    </div>
                  </div>
                </div>
                <ul className="space-y-2">
                  {dist.map((d) => (
                    <li key={d.key} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[d.key]}`} />
                        <span className="text-ink-700">{d.label}</span>
                      </span>
                      <span className="text-ink-500">{d.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-ink-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h2 className="text-sm font-medium text-ink-900">我的任务</h2>
            <Link href="/tasks" className="text-sm font-medium text-brand-600 transition-colors duration-200 hover:text-brand-700">
              全部任务
            </Link>
          </div>
          {myTicketsError ? (
            <div className="mx-5 my-5 rounded-lg border border-red-100 bg-red-50 px-5 py-3 text-sm text-danger">
              任务数据加载失败，请稍后刷新页面。
            </div>
          ) : myTicketsLoading ? (
            <div className="divide-y divide-ink-100">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-lg bg-ink-100" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-ink-200" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-ink-100" />
                    </div>
                    <div className="h-6 w-16 animate-pulse rounded-full bg-ink-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
              <div className="rounded-full bg-ink-100 p-3 text-ink-400">
                <IconTask className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-ink-900">暂无指派给你的任务</h3>
              <p className="mt-1 text-sm text-ink-500">去项目里领取任务开始工作吧</p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {sortedTickets.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className="flex items-start gap-3 px-5 py-4 transition-colors duration-200 hover:bg-ink-100/40"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-sm font-semibold text-ink-700">
                      #{t.ticketNo}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{t.title}</p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}
                        >
                          {STATUS_LABEL[t.status]}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-ink-400">
                        {t.project.name} · {KIND_LABEL[t.module.responsibility.kind]} / {t.module.name}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
