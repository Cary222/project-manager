"use client";

import Link from "next/link";
import useSWR from "swr";
import { AppShell } from "@/components/AppShell";
import { TicketDetailHeaderSkeleton, TicketDetail } from "@/components/ticket/ticket-detail/TicketDetail";
import { fetchJson } from "@/lib/fetch-json";
import { KIND_LABEL } from "@/components/ticket/ticket-detail/types";

function DispatchTicketDetailHeader({ ticketId }: { ticketId: string }) {
  const { data } = useSWR<{
    ticket: {
      ticketNo: number;
      project: { id: string; name: string };
      module: { name: string; responsibility: { kind: string } };
    };
  }>(`/api/tickets/${ticketId}`, fetchJson);
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

export default async function DispatchTicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return (
    <AppShell header={<DispatchTicketDetailHeader ticketId={ticketId} />}>
      <TicketDetail ticketId={ticketId} />
    </AppShell>
  );
}
