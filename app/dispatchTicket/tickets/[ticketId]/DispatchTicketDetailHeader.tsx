"use client";

import Link from "next/link";
import { useEffect } from "react";
import useSWR from "swr";
import { TicketDetailHeaderSkeleton } from "@/features/ticket/ui/ticket-detail/TicketDetail";
import { fetchJson } from "@/shared/api/fetch-json";
import { KIND_LABEL } from "@/entities/ticket/model/types";
import { useRecentVisits } from "@/shared/lib/visits-context";

export function DispatchTicketDetailHeader({ ticketId }: { ticketId: string }) {
  const { data } = useSWR<{
    ticket: {
      ticketNo: number;
      title?: string;
      project: { id: string; name: string };
      module: { name: string; responsibility: { kind: string } };
    };
  }>(`/api/tickets/${ticketId}`, fetchJson);
  const { scheduleRecord } = useRecentVisits();

  useEffect(() => {
    const ticket = data?.ticket;
    if (!ticket) return;
    // scheduleRecord 在停留 5 秒后才写 visits 并计次。
    // SWR 重新验证 data 变化会重新调度 timer，用户离开后再次停留满 5s 才再计一次。
    scheduleRecord({
      projectId: ticket.project.id,
      projectName: ticket.project.name,
      tabKey: "ticket",
      tabLabel: `#${ticket.ticketNo}`,
      ticketId,
      ticketNo: ticket.ticketNo,
      ticketTitle: ticket.title,
    });
  }, [data, scheduleRecord, ticketId]);

  if (!data?.ticket) return <TicketDetailHeaderSkeleton />;
  const { ticket } = data;
  return (
    <div className="flex items-center gap-3">
      <Link
        href={`/dispatchTicket/${ticket.project.id}`}
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        aria-label="返回派单"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Link>
      <div>
        <h1 className="text-lg font-semibold leading-tight">#{ticket.ticketNo}</h1>
        <p className="text-xs text-ink-400">
          {ticket.project.name} · {KIND_LABEL[ticket.module.responsibility.kind as "PROGRAM" | "DESIGN" | "BUG"]} / {ticket.module.name}
        </p>
      </div>
    </div>
  );
}
