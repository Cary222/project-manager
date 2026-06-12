"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconSearch, IconSettings, IconTask, IconTeam } from "@/components/common/icons";
import { BackLink, SimplePageHeader, HeaderSkeleton } from "@/components/ui/headers";
import {
  KIND_LABEL,
  type TicketStatus,
  type MyTicket,
} from "@/components/ticket/ticket-detail/types";

// ---- Types ----

type ProjectTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  project: { id: string; name: string };
  module: { name: string; responsibility: { kind: "PROGRAM" | "DESIGN" } };
};

export type ProjectWithStatus = {
  id: string;
  name: string;
  description: string | null;
  status?: string;
  responsibilities?: {
    modules?: {
      tickets?: MyTicket[];
    }[];
  }[];
};

// ---- Kanban column config ----

const COLUMNS: { key: TicketStatus; label: string; accent: string; head: string }[] = [
  { key: "DEVELOPING", label: "开发中", accent: "border-t-brand-500", head: "text-brand-700 bg-brand-50" },
  { key: "READY_FOR_TEST", label: "待测试", accent: "border-t-amber-500", head: "text-amber-700 bg-amber-50" },
  { key: "DELIVERED", label: "已交付", accent: "border-t-purple", head: "text-violet-700 bg-violet-50" },
  { key: "DONE", label: "已完成", accent: "border-t-emerald-500", head: "text-emerald-700 bg-emerald-50" },
];

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-brand-50 text-brand-700",
  MAINTENANCE: "bg-amber-50 text-amber-700",
  ARCHIVED: "bg-ink-100 text-ink-500",
};

// ---- Progress bar ----

function TaskProgressBar({ total, done }: { total: number; done: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs font-medium text-ink-500">{pct}%</span>
    </div>
  );
}

// ---- Skeletons ----

function KanbanSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => (
        <section
          key={col.key}
          className={`rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="h-5 w-16 rounded-full bg-ink-100" />
            <div className="h-4 w-6 rounded bg-ink-100" />
          </div>
          <div className="space-y-2">
            {[0, 1, 2].map((idx) => (
              <div
                key={`sk-${idx}`}
                className="rounded-lg border border-ink-100 bg-white p-3 shadow-soft"
              >
                <div className="flex items-center justify-between">
                  <div className="h-3 w-12 rounded bg-ink-100" />
                  <div className="h-5 w-10 rounded bg-ink-100" />
                </div>
                <div className="mt-2 h-4 w-4/5 rounded bg-ink-100" />
                <div className="mt-2 h-3 w-2/3 rounded bg-ink-100" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- Kanban columns ----

function KanbanColumns({ tickets, query }: { tickets: ProjectTicket[]; query: string }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        String(t.ticketNo).includes(q) ||
        t.module.name.toLowerCase().includes(q),
    );
  }, [tickets, query]);

  const grouped = useMemo(() => {
    const map: Record<TicketStatus, ProjectTicket[]> = {
      DEVELOPING: [],
      READY_FOR_TEST: [],
      DELIVERED: [],
      DONE: [],
    };
    for (const t of filtered) map[t.status].push(t);
    for (const k of Object.keys(map) as TicketStatus[]) {
      map[k].sort((a, b) => b.ticketNo - a.ticketNo);
    }
    return map;
  }, [filtered]);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = grouped[col.key];
        return (
          <section
            key={col.key}
            className={`rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${col.head}`}>
                {col.label}
              </span>
              <span className="text-sm text-ink-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink-200 py-8 text-center text-xs text-ink-400">
                  暂无任务
                </p>
              ) : (
                items.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="block rounded-lg border border-ink-100 bg-white p-3 shadow-soft transition hover:border-brand-200 hover:shadow-base"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-ink-400">#{t.ticketNo}</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500">
                        {KIND_LABEL[t.module.responsibility.kind]}
                      </span>
                    </div>
                    <p
                      className={`mt-1.5 text-sm font-medium ${
                        t.status === "DONE" ? "text-ink-400 line-through" : "text-ink-900"
                      }`}
                    >
                      {t.title}
                    </p>
                    <p className="mt-2 truncate text-xs text-ink-400">
                      {t.project.name} · {t.module.name}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---- Task tab content ----

type TaskTabProps = {
  tickets: ProjectTicket[];
  taskCounts: TaskCounts;
};

function TaskTab({ tickets, taskCounts }: TaskTabProps) {
  const [query, setQuery] = useState("");

  return (
    <div className="space-y-5">
      <TaskProgressBar total={taskCounts.total} done={taskCounts.done} />

      <div className="relative w-full max-w-sm">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任务标题、编号、模块…"
          className="w-full rounded-lg border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <KanbanColumns tickets={tickets} query={query} />
    </div>
  );
}

// ---- Member tab placeholder ----

function MemberTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 py-20 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <IconTeam className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-ink-500">成员管理</p>
      <p className="mt-1 text-xs text-ink-400">即将上线</p>
    </div>
  );
}

// ---- Settings tab placeholder ----

function SettingsTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 py-20 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <IconSettings className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-ink-500">项目设置</p>
      <p className="mt-1 text-xs text-ink-400">即将上线</p>
    </div>
  );
}

// ---- Tab navigation ----

type TabKey = "tasks" | "members" | "settings";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "tasks", label: "任务", icon: <IconTask className="h-4 w-4" /> },
  { key: "members", label: "成员", icon: <IconTeam className="h-4 w-4" /> },
  { key: "settings", label: "设置", icon: <IconSettings className="h-4 w-4" /> },
];

function TabNav({
  active,
  onChange,
  taskCount,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  taskCount: number;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              isActive
                ? "bg-brand-50 text-brand-700"
                : "text-ink-500 hover:bg-ink-50 hover:text-ink-700"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.key === "tasks" && taskCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                  isActive ? "bg-brand-100 text-brand-600" : "bg-ink-100 text-ink-500"
                }`}
              >
                {taskCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Stat pill ----

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "brand" | "amber" | "green";
}) {
  const toneClass =
    tone === "brand"
      ? "bg-brand-50 text-brand-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : tone === "green"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-white text-ink-600";
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${toneClass}`}>
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-xs text-ink-400">{label}</span>
    </div>
  );
}

// ---- Task counts ----

type TaskCounts = { total: number; developing: number; test: number; done: number };

function computeTaskCounts(data: { project: ProjectWithStatus } | undefined): TaskCounts {
  const resp = (data?.project as ProjectWithStatus | undefined)?.responsibilities ?? [];
  const tickets = resp.flatMap((r) => r.modules ?? []).flatMap((m) => m.tickets ?? []);
  return {
    total: tickets.length,
    developing: tickets.filter((t: MyTicket) => t.status === "DEVELOPING").length,
    test: tickets.filter((t: MyTicket) => t.status === "READY_FOR_TEST").length,
    done: tickets.filter((t: MyTicket) => t.status === "DONE").length,
  };
}

// ---- Page header (exported for AppShell) ----

export function PageHeader({ projectName }: { projectName: string }) {
  return (
    <div className="flex items-center gap-3">
      <BackLink href="/projects" label="返回项目列表" />
      <SimplePageHeader title={projectName} />
    </div>
  );
}

export function PageHeaderSkeleton() {
  return <HeaderSkeleton titleW={8} subtitleW={12} />;
}

// ---- Main component ----

export function ProjectDetail({ project }: { project: ProjectWithStatus }) {
  const [activeTab, setActiveTab] = useState<TabKey>("tasks");

  const taskCounts = useMemo(() => computeTaskCounts({ project }), [project]);

  const tickets = useMemo<ProjectTicket[]>(() => {
    return (
      project.responsibilities
        ?.flatMap((r) => r.modules ?? [])
        .flatMap((m) => m.tickets ?? [])
        .map((t) => ({
          id: t.id,
          ticketNo: t.ticketNo,
          title: t.title,
          status: t.status as TicketStatus,
          project: { id: project.id, name: project.name },
          module: {
            name: t.module?.name ?? "",
            responsibility: { kind: t.module?.responsibility?.kind ?? "PROGRAM" },
          },
        })) ?? []
    );
  }, [project]);

  return (
    <div className="space-y-5 pm-fade-in">
      {/* Card wrapper: project info + progress + tabs */}
      <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
        {/* Project info row */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 pb-0">
          {/* Left: icon + name + description */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <IconTask className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-tight">{project.name}</h2>
              {project.description && (
                <p className="mt-0.5 text-sm text-ink-400">{project.description}</p>
              )}
            </div>
          </div>

          {/* Right: status badge + stat pills */}
          <div className="flex flex-wrap items-center gap-2">
            {project.status && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  STATUS_STYLE[project.status] ?? "bg-ink-100 text-ink-500"
                }`}
              >
                {project.status === "ACTIVE" ? "进行中" : project.status === "MAINTENANCE" ? "维护中" : "已归档"}
              </span>
            )}
            <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
              <StatPill label="总任务" value={taskCounts.total} tone="default" />
              <StatPill label="开发中" value={taskCounts.developing} tone="brand" />
              <StatPill label="待测试" value={taskCounts.test} tone="amber" />
              <StatPill label="已完成" value={taskCounts.done} tone="green" />
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="border-t border-ink-100 px-5 pb-4 pt-4">
          <TabNav
            active={activeTab}
            onChange={setActiveTab}
            taskCount={taskCounts.total}
          />
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "tasks" && <TaskTab tickets={tickets} taskCounts={taskCounts} />}
      {activeTab === "members" && <MemberTab />}
      {activeTab === "settings" && <SettingsTab />}
    </div>
  );
}

// ---- Loading skeleton ----

export function ProjectDetailLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Card skeleton */}
      <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 pb-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-ink-100" />
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-ink-100" />
              <div className="h-3 w-24 rounded bg-ink-100" />
            </div>
          </div>
          <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={`sp-${i}`} className="h-7 w-16 rounded-md bg-ink-100" />
            ))}
          </div>
        </div>
        <div className="border-t border-ink-100 px-5 pb-4 pt-4">
          <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
            {["任务", "成员", "设置"].map((t) => (
              <div key={t} className="h-8 w-16 rounded-md bg-ink-100" />
            ))}
          </div>
        </div>
      </div>
      {/* Kanban skeleton */}
      <KanbanSkeleton />
    </div>
  );
}
