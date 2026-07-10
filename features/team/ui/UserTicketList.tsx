"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import {
  type TicketStatus,
  STATUS_LABEL,
  STATUS_STYLE,
  PRIORITY_LABEL,
} from "@/entities/ticket/model/types";

type UserTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  priority: number;
  project: { id: string; name: string };
  module: { id: string; name: string };
};

type Props = {
  userId: string;
};

function UserTicketTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="divide-y divide-ink-100">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="h-4 w-12 animate-pulse rounded bg-ink-100" />
            <div className="h-5 w-8 animate-pulse rounded bg-ink-100" />
            <div className="h-4 w-64 animate-pulse rounded bg-ink-100" />
            <div className="h-4 w-32 animate-pulse rounded bg-ink-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function UserTicketList({ userId }: Props) {
  const { data, error, isLoading } = useSWR<{ tickets: UserTicket[] }>(
    `/api/tickets/user/${userId}`,
    fetchJson,
    STALE_SWR_OPTIONS
  );

  const tickets = data?.tickets ?? [];

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        加载失败，请稍后重试
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 表头 */}
      <div className="hidden grid-cols-12 gap-4 border-b border-ink-200 bg-ink-100/60 px-5 py-3 text-xs font-medium text-ink-500 md:grid">
        <div className="col-span-1">单号</div>
        <div className="col-span-2">优先级</div>
        <div className="col-span-5">标题</div>
        <div className="col-span-2">项目 / 模块</div>
        <div className="col-span-2">状态</div>
      </div>

      {isLoading ? (
        <UserTicketTableSkeleton />
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
          <p className="text-sm text-ink-500">暂无单子</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
          <ul className="divide-y divide-ink-100">
            {tickets.map((t) => {
              const isClosed = t.status === "DONE" || t.status === "DELIVERED";
              return (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className={`grid grid-cols-1 gap-2 px-5 py-4 transition md:grid-cols-12 md:items-center md:gap-4 ${
                      isClosed ? "opacity-60 hover:bg-ink-100/40" : "hover:bg-ink-100/40"
                    }`}
                  >
                    <div className="col-span-1">
                      <span className="font-mono text-sm text-ink-400">#{t.ticketNo}</span>
                    </div>
                    <div className="col-span-2">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${
                          t.priority === 0
                            ? "bg-red-100 text-red-700 border-red-300"
                            : t.priority === 1
                              ? "bg-amber-100 text-amber-700 border-amber-300"
                              : t.priority === 2
                                ? "bg-brand-50 text-brand-700 border-brand-200"
                                : "bg-ink-100 text-ink-500 border-ink-200"
                        }`}
                      >
                        {PRIORITY_LABEL[t.priority as 0 | 1 | 2 | 3] ?? `P${t.priority}`}
                      </span>
                    </div>
                    <div className="col-span-5 min-w-0">
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
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
