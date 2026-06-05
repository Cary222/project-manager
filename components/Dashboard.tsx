"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  IconClock,
  IconPlus,
  IconProject,
  IconSearch,
  IconTask,
} from "@/components/icons";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DELIVERED" | "DONE";

type MyTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  project: { id: string; name: string };
  module: {
    name: string;
    responsibility: { kind: "PROGRAM" | "DESIGN" };
  };
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DELIVERED: "已交付",
  DONE: "已完成",
};

const STATUS_ORDER: Record<TicketStatus, number> = {
  DEVELOPING: 0,
  READY_FOR_TEST: 1,
  DELIVERED: 2,
  DONE: 3,
};

const STATUS_STYLE: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-50 text-brand-700",
  READY_FOR_TEST: "bg-amber-50 text-amber-600",
  DELIVERED: "bg-violet-50 text-violet-700",
  DONE: "bg-emerald-50 text-emerald-600",
};

const STATUS_DOT: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-500",
  READY_FOR_TEST: "bg-warning",
  DELIVERED: "bg-purple",
  DONE: "bg-success",
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
    brand: "bg-brand-50 text-brand-600",
    amber: "bg-amber-50 text-warning",
    danger: "bg-red-50 text-danger",
    purple: "bg-violet-50 text-purple",
  } as const;
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft transition hover:shadow-base">
      <div className="flex items-start justify-between">
        <p className="text-sm text-ink-500">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneMap[tone]}`}>
          {icon}
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function Dashboard() {
  const { data: session } = useSession();

  const [projects, setProjects] = useState<Project[]>([]);
  const [myTickets, setMyTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = (await res.json()) as { projects: Project[] };
    setProjects(data.projects);
  }, []);

  const loadMyTickets = useCallback(async () => {
    const res = await fetch("/api/tickets/mine");
    if (!res.ok) return;
    const data = (await res.json()) as { tickets: MyTicket[] };
    setMyTickets(data.tickets);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([loadProjects(), loadMyTickets()]).finally(() =>
      setLoading(false)
    );
  }, [loadProjects, loadMyTickets]);

  const counts = useMemo(() => {
    const developing = myTickets.filter((t) => t.status === "DEVELOPING").length;
    const test = myTickets.filter((t) => t.status === "READY_FOR_TEST").length;
    const delivered = myTickets.filter((t) => t.status === "DELIVERED").length;
    const done = myTickets.filter((t) => t.status === "DONE").length;
    return {
      projects: projects.length,
      myTickets: myTickets.length,
      developing,
      test,
      delivered,
      done,
      pending: developing + test + delivered,
    };
  }, [projects, myTickets]);

  const sortedTickets = useMemo(() => sortMyTickets(myTickets), [myTickets]);

  // 任务状态分布（环形条）
  const total = counts.myTickets || 1;
  const dist: { key: TicketStatus; label: string; count: number; pct: number }[] = [
    {
      key: "DEVELOPING",
      label: "开发中",
      count: counts.developing,
      pct: Math.round((counts.developing / total) * 100),
    },
    {
      key: "READY_FOR_TEST",
      label: "待测试",
      count: counts.test,
      pct: Math.round((counts.test / total) * 100),
    },
    {
      key: "DELIVERED",
      label: "已交付",
      count: counts.delivered,
      pct: Math.round((counts.delivered / total) * 100),
    },
    {
      key: "DONE",
      label: "已完成",
      count: counts.done,
      pct: Math.round((counts.done / total) * 100),
    },
  ];

  const quickActions = [
    { label: "新建项目", href: "/projects", icon: <IconPlus className="h-5 w-5" /> },
    { label: "我的任务", href: "/tasks", icon: <IconTask className="h-5 w-5" /> },
    { label: "写笔记", href: "/pkm", icon: <IconProject className="h-5 w-5" /> },
    { label: "全局搜索", href: "/knowledge", icon: <IconSearch className="h-5 w-5" /> },
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
        {/* 问候 + 快捷操作 */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-ink-200 bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-base lg:col-span-2">
            <p className="text-2xl font-semibold">
              {greeting()}，{session?.user?.name || "同学"} 👋
            </p>
            <p className="mt-2 text-sm text-brand-100">
              你有 <span className="font-semibold text-white">{counts.pending}</span> 个任务待推进，
              当前负责 <span className="font-semibold text-white">{counts.projects}</span> 个项目。
            </p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
            <p className="mb-3 text-sm font-medium text-ink-500">快捷操作</p>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map((a) => (
                <Link
                  key={a.label}
                  href={a.href}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-ink-100 bg-ink-100/60 px-3 py-3 text-center text-xs font-medium text-ink-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                >
                  <span className="text-brand-600">{a.icon}</span>
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 统计卡片 */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="项目数"
            value={loading ? "—" : counts.projects}
            hint="我可见的项目"
            tone="brand"
            icon={<IconProject className="h-5 w-5" />}
          />
          <StatCard
            label="我的任务"
            value={loading ? "—" : counts.myTickets}
            hint={`进行中 ${counts.developing} · 待测试 ${counts.test} · 已交付 ${counts.delivered}`}
            tone="purple"
            icon={<IconTask className="h-5 w-5" />}
          />
          <StatCard
            label="待处理"
            value={loading ? "—" : counts.pending}
            hint="及时处理，避免堆积"
            tone="danger"
            icon={<IconClock className="h-5 w-5" />}
          />
          <StatCard
            label="已完成"
            value={loading ? "—" : counts.done}
            hint="累计完成任务"
            tone="amber"
            icon={<IconTask className="h-5 w-5" />}
          />
        </section>

        {/* 我负责的项目 + 任务状态分布 */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">我可见的项目</h2>
              <Link
                href="/projects"
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                查看全部
              </Link>
            </div>
            {loading ? (
              <p className="py-10 text-center text-sm text-ink-400">加载中…</p>
            ) : projects.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink-200 py-10 text-center text-sm text-ink-400">
                暂无项目
              </p>
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
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/projects/${p.id}`}
                        className="flex items-center gap-3 rounded-lg border border-ink-100 px-3 py-3 transition hover:border-brand-200 hover:bg-brand-50/40"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.name}</p>
                          {p.description ? (
                            <p className="truncate text-xs text-ink-400">
                              {p.description}
                            </p>
                          ) : null}
                        </div>
                        <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-500">
                          {p.status === "ACTIVE" ? "进行中" : p.status}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 font-medium">任务状态分布</h2>
            <div className="mb-4 flex items-center justify-center">
              <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-ink-100">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `conic-gradient(var(--color-brand-500) 0% ${dist[0].pct}%, var(--color-warning) ${dist[0].pct}% ${
                      dist[0].pct + dist[1].pct
                    }%, var(--color-success) ${dist[0].pct + dist[1].pct}% 100%)`,
                  }}
                />
                <div className="relative flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white">
                  <span className="text-xl font-semibold">{counts.myTickets}</span>
                  <span className="text-xs text-ink-400">总数</span>
                </div>
              </div>
            </div>
            <ul className="space-y-2">
              {dist.map((d) => (
                <li key={d.key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[d.key]}`} />
                    {d.label}
                  </span>
                  <span className="text-ink-500">{d.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 我的任务列表 */}
        <section className="rounded-xl border border-ink-200 bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
            <h2 className="font-medium">我的任务</h2>
            <Link href="/tasks" className="text-sm text-brand-600 hover:text-brand-700">
              全部任务
            </Link>
          </div>
          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-ink-400">加载中…</p>
          ) : sortedTickets.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-ink-400">
              暂无指派给你的任务
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {sortedTickets.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/${t.ticketNo}`}
                    className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-ink-100/50"
                  >
                    <span className="font-mono text-xs text-ink-400">
                      #{t.ticketNo}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        t.status === "DONE" ? "text-ink-400 line-through" : ""
                      }`}
                    >
                      {t.title}
                    </span>
                    <span className="hidden text-xs text-ink-400 sm:inline">
                      {t.project.name} · {KIND_LABEL[t.module.responsibility.kind]}/
                      {t.module.name}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}
                    >
                      {STATUS_LABEL[t.status]}
                    </span>
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
