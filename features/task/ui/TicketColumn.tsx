"use client";

import Link from "next/link";
import { type TicketStatus } from "@/entities/ticket/model/types";
import { PriorityBadge } from "@/shared/ui/PriorityBadge";

export const KIND_LABEL: Record<"PROGRAM" | "DESIGN", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

export const COLUMNS: {
  key: TicketStatus;
  label: string;
  accent: string;
  head: string;
}[] = [
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

export type TicketItem = {
  id: string;
  ticketNo: number;
  title: string;
  priority: number;
  status: TicketStatus;
  module: {
    name: string;
    responsibility: {
      kind: "PROGRAM" | "DESIGN";
    };
  };
  project: {
    name: string;
  };
};

type TicketColumnProps = {
  col: (typeof COLUMNS)[number];
  items: TicketItem[];
  count?: number;
  skeleton?: boolean;
};

export function TicketColumnSkeleton({ col }: { col: (typeof COLUMNS)[number] }) {
  return (
    <section
      className={`flex max-h-[420px] flex-col rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="h-5 w-16 rounded-full bg-ink-100" />
        <div className="h-4 w-6 rounded bg-ink-100" />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
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
  );
}

export function TicketColumnsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => (
        <TicketColumnSkeleton key={col.key} col={col} />
      ))}
    </div>
  );
}

export function TicketColumn({ col, items, count, skeleton }: TicketColumnProps) {
  if (skeleton) {
    return <TicketColumnSkeleton col={col} />;
  }

  const displayCount = count ?? items.length;

  return (
    <section
      className={`flex max-h-[420px] flex-col rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${col.head}`}>
          {col.label}
        </span>
        <span className="text-sm text-ink-400">{displayCount}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
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
}

export function TicketColumnsGrid({ grouped }: { grouped: Record<TicketStatus, TicketItem[]> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => (
        <TicketColumn key={col.key} col={col} items={grouped[col.key]} />
      ))}
    </div>
  );
}
