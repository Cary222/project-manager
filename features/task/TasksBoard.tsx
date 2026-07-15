"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { IconSearch } from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import { type TicketStatus, type MyTicket } from "@/entities/ticket/model/types";
import {
  COLUMNS,
  KIND_LABEL,
  TicketColumnsGrid,
  TicketColumnsSkeleton,
  type TicketItem,
} from "@/features/task/ui/TicketColumn";

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
    const map: Record<TicketStatus, TicketItem[]> = {
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

      {isLoading ? (
        <TicketColumnsSkeleton />
      ) : (
        <TicketColumnsGrid grouped={grouped} />
      )}
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

      <TicketColumnsSkeleton />
    </div>
  );
}
