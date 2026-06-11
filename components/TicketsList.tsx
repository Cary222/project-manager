"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppShell } from "@/components/AppShell";
import { IconSearch } from "@/components/icons";
import { fetchJson } from "@/lib/fetch-json";
import { STALE_SWR_OPTIONS } from "@/lib/swr-config";
import {
  type TicketStatus,
  STATUS_LABEL,
  STATUS_STYLE,
  STATUS_ORDER,
} from "@/components/ticket-detail/types";

type ListTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  project: { id: string; name: string };
  module: { name: string; responsibility: { kind: string } };
  assignees: { id: string; name: string | null; email: string }[];
};

const KIND_LABEL: Record<string, string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
  BUG: "Bug",
};

function TicketsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="hidden grid-cols-12 gap-4 border-b border-ink-100 bg-ink-100/60 px-5 py-3 text-xs font-medium text-ink-500 md:grid">
        <div className="col-span-2">单号</div>
        <div className="col-span-4">标题</div>
        <div className="col-span-2">项目 / 模块</div>
        <div className="col-span-2">状态</div>
        <div className="col-span-2">指派给</div>
      </div>
      <div className="divide-y divide-ink-100">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-2 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
          >
            <div className="col-span-2">
              <div className="h-4 w-16 animate-pulse rounded bg-ink-100" />
            </div>
            <div className="col-span-4">
              <div className="h-4 w-48 animate-pulse rounded bg-ink-100" />
            </div>
            <div className="col-span-2">
              <div className="h-4 w-32 animate-pulse rounded bg-ink-100" />
            </div>
            <div className="col-span-2">
              <div className="h-6 w-16 animate-pulse rounded-full bg-ink-100" />
            </div>
            <div className="col-span-2">
              <div className="h-4 w-20 animate-pulse rounded bg-ink-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketsTable({
  query,
  onMessage,
}: {
  query: string;
  onMessage: (message: string) => void;
}) {
  const { data, error, isLoading } = useSWR<{ tickets: ListTicket[] }>(
    "/api/tickets",
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const tickets = useMemo(() => data?.tickets ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        String(t.ticketNo).includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.project.name.toLowerCase().includes(q) ||
        t.module.name.toLowerCase().includes(q)
    );
  }, [tickets, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.ticketNo - a.ticketNo;
    });
  }, [filtered]);

  if (error) {
    return (
      <p className="rounded-lg border border-danger/20 bg-red-50 px-3 py-2 text-sm text-danger">
        数据加载失败，请稍后重试。
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="hidden grid-cols-12 gap-4 border-b border-ink-100 bg-ink-100/60 px-5 py-3 text-xs font-medium text-ink-500 md:grid">
        <div className="col-span-2">单号</div>
        <div className="col-span-4">标题</div>
        <div className="col-span-2">项目 / 模块</div>
        <div className="col-span-2">状态</div>
        <div className="col-span-2">指派给</div>
      </div>
      {isLoading ? (
        <div className="px-5 py-12 text-center text-sm text-ink-400">加载中…</div>
      ) : sorted.length === 0 ? (
        <p className="px-5 py-16 text-center text-sm text-ink-400">
          {query ? "没有匹配的单子" : "暂无单子"}
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {sorted.map((t) => {
            const isClosed = t.status === "DONE" || t.status === "DELIVERED";
            return (
              <li key={t.id}>
                <Link
                  href={`/tickets/${t.id}`}
                  className={`grid grid-cols-1 gap-2 px-5 py-4 transition md:grid-cols-12 md:items-center md:gap-4 ${
                    isClosed
                      ? "opacity-60 hover:bg-ink-100/40"
                      : "hover:bg-ink-100/40"
                  }`}
                >
                  <div className="col-span-2">
                    <span className="font-mono text-sm text-ink-400">#{t.ticketNo}</span>
                  </div>
                  <div className="col-span-4 min-w-0">
                    <p
                      className={`truncate text-sm ${
                        isClosed ? "text-ink-400 line-through" : "font-medium text-ink-900"
                      }`}
                    >
                      {t.title}
                    </p>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <p className="truncate text-xs text-ink-500">
                      {t.project?.name ?? "—"}
                      {t.module?.name ? ` / ${t.module.name}` : ""}
                    </p>
                    <p className="text-xs text-ink-400">
                      {t.module?.responsibility?.kind ? KIND_LABEL[t.module.responsibility.kind] : "—"}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[t.status] || "bg-ink-100 text-ink-500"
                      }`}
                    >
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <div className="col-span-2 min-w-0">
                    {t.assignees.length === 0 ? (
                      <span className="text-xs text-ink-400">未指派</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {t.assignees.slice(0, 2).map((u) => (
                          <span
                            key={u.id}
                            className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-600"
                          >
                            {u.name || u.email}
                          </span>
                        ))}
                        {t.assignees.length > 2 && (
                          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-400">
                            +{t.assignees.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TicketsToolbar({
  message,
  onMessage,
  onQueryChange,
}: {
  message: string;
  onMessage: (message: string) => void;
  onQueryChange: (query: string) => void;
}) {
  const [queryInput, setQueryInput] = useState("");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={queryInput}
            onChange={(e) => {
              const nextQuery = e.target.value;
              setQueryInput(nextQuery);
              onQueryChange(nextQuery);
            }}
            placeholder="搜索单号、标题、项目、模块…"
            className="w-full rounded-lg border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </div>

      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
    </>
  );
}

function TicketsListHeader() {
  return (
    <div>
      <h1 className="text-lg font-semibold leading-tight">单子</h1>
      <p className="text-xs text-ink-400">Tickets · 所有单子列表</p>
    </div>
  );
}

export function TicketsList() {
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  return (
    <AppShell header={<TicketsListHeader />}>
      <div className="space-y-5 pm-fade-in">
        <TicketsToolbar
          message={message}
          onMessage={setMessage}
          onQueryChange={setQuery}
        />
        <TicketsTable query={query} onMessage={setMessage} />
      </div>
    </AppShell>
  );
}

export function TicketsListLoading() {
  return (
    <AppShell header={<TicketsListHeader />}>
      <div className="space-y-5 pm-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <div className="h-[42px] w-full animate-pulse rounded-lg border border-ink-200 bg-white" />
          </div>
        </div>
        <TicketsTableSkeleton />
      </div>
    </AppShell>
  );
}

export function TicketsListHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 animate-pulse rounded-lg bg-ink-200" />
      <div className="space-y-2">
        <div className="h-5 w-20 animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-32 animate-pulse rounded bg-ink-100" />
      </div>
    </div>
  );
}
