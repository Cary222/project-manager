"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { IconSearch } from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import { type TicketStatus, type MyTicket } from "@/entities/ticket/model/types";

const COLUMNS: { key: TicketStatus; label: string; accent: string; head: string }[] =
  [
    {
      key: "DEVELOPING",
      label: "开发中",
      accent: "border-t-brand-500",
      head: "text-brand-700 bg-brand-50",
    },
    {
      key: "READY_FOR_TEST",
      label: "待测试",
      accent: "border-t-warning",
      head: "text-amber-700 bg-amber-50",
    },
    {
      key: "DELIVERED",
      label: "已交付",
      accent: "border-t-purple",
      head: "text-violet-700 bg-violet-50",
    },
    {
      key: "DONE",
      label: "已完成",
      accent: "border-t-success",
      head: "text-emerald-700 bg-emerald-50",
    },
    {
      key: "OVERDUE",
      label: "已逾期",
      accent: "border-t-red-500",
      head: "text-red-700 bg-red-50",
    },
    {
      key: "CLOSED",
      label: "已关闭",
      accent: "border-t-ink-400",
      head: "text-ink-600 bg-ink-100",
    },
  ];

function PriorityBadge({ priority }: { priority: number }) {
  const styles: Record<number, string> = {
    0: "bg-danger text-white border-danger",
    1: "bg-warning text-white border-warning",
    2: "bg-brand-50 text-brand-700 border-brand-200",
    3: "bg-ink-100 text-ink-500 border-ink-200",
  };
  const labels: Record<number, string> = { 0: "P0", 1: "P1", 2: "P2", 3: "P3" };
  return (
    <span className={`inline-block rounded border px-1 py-0.5 text-[10px] font-semibold ${styles[priority] ?? styles[2]}`}>
      {labels[priority] ?? "P2"}
    </span>
  );
}

const KIND_LABEL: Record<"PROGRAM" | "DESIGN", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

function TasksColumnsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => (
        <section
          key={col.key}
          className={`rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${col.head}`}>
              {col.label}
            </span>
            <div className="h-4 w-6 animate-pulse rounded bg-ink-100" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`${col.key}-${index}`}
                className="rounded-lg border border-ink-100 bg-white p-3 shadow-soft"
              >
                <div className="flex items-center justify-between">
                  <div className="h-3 w-12 animate-pulse rounded bg-ink-100" />
                  <div className="h-5 w-10 animate-pulse rounded bg-ink-100" />
                </div>
                <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-ink-100" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-ink-100" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TasksColumns({ query }: { query: string }) {
  const { data, error, isLoading } = useSWR<{ tickets: MyTicket[] }>(
    "/api/tickets/mine",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const tickets = useMemo(() => data?.tickets ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        String(t.ticketNo).includes(q) ||
        t.project.name.toLowerCase().includes(q)
    );
  }, [tickets, query]);

  const grouped = useMemo(() => {
    const map: Record<TicketStatus, MyTicket[]> = {
      DEVELOPING: [],
      READY_FOR_TEST: [],
      DELIVERED: [],
      DONE: [],
      OVERDUE: [],
      CLOSED: [],
    };
    for (const t of filtered) map[t.status].push(t);
    for (const k of Object.keys(map) as TicketStatus[]) {
      map[k].sort((a, b) => b.ticketNo - a.ticketNo);
    }
    return map;
  }, [filtered]);

  if (error) {
    return (
      <p className="rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-sm text-danger">
        任务加载失败，请稍后重试。
      </p>
    );
  }

  if (isLoading) {
    return <TasksColumnsSkeleton />;
  }

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
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={t.priority} />
                      <span className="font-mono text-xs text-ink-400">#{t.ticketNo}</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500">
                        {KIND_LABEL[t.module.responsibility.kind]}
                      </span>
                    </div>
                    <p
                      className={`mt-1.5 text-sm font-medium ${
                        t.status === "DONE"
                          ? "text-ink-400 line-through"
                          : "text-ink-900"
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

function TasksBoardHeader() {
  return (
    <div>
      <h1 className="text-lg font-semibold leading-tight">任务看板</h1>
      <p className="text-xs text-ink-400">Task Board · 指派给我的任务</p>
    </div>
  );
}

export function TasksBoard() {
  const [query, setQuery] = useState("");

  return (
    <div className="space-y-5 pm-fade-in">
      <div className="relative w-full max-w-sm">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任务标题、编号、项目…"
          className="w-full rounded-lg border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <TasksColumns query={query} />
    </div>
  );
}

export function TasksBoardHeaderSkeleton() {
  return (
    <div>
      <div className="h-5 w-24 animate-pulse rounded bg-ink-200" />
      <div className="mt-1 h-3 w-40 animate-pulse rounded bg-ink-100" />
    </div>
  );
}

export function TasksBoardLoading() {
  return (
    <div className="space-y-5 pm-fade-in">
      <div className="relative w-full max-w-sm">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <div className="h-[42px] w-full animate-pulse rounded-lg border border-ink-200 bg-white" />
      </div>

      <TasksColumnsSkeleton />
    </div>
  );
}
