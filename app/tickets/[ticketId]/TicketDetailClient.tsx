"use client";

import { default as NextDynamic } from "next/dynamic";
import useSWR from "swr";
import { AppShell } from "@/components/AppShell";
import { BackLink, SimplePageHeader, HeaderSkeleton } from "@/components/ui/headers";
import { TicketDetailLoading } from "@/components/ticket/ticket-detail/TicketDetail";
import { TicketDetailHeaderSkeleton } from "@/components/ticket/ticket-detail/TicketDetail";
import { fetchJson } from "@/lib/fetch-json";
import { KIND_LABEL } from "@/components/ticket/ticket-detail/types";

const TicketDetail = NextDynamic(
  () => import("@/components/ticket/ticket-detail/TicketDetail").then((m) => m.TicketDetail),
  {
    loading: () => (
      <AppShell header={<TicketDetailHeaderSkeleton />}>
        <TicketDetailLoading />
      </AppShell>
    ),
  }
);

function TicketDetailHeader({ ticketId }: { ticketId: string }) {
  const { data } = useSWR<{
    ticket: {
      ticketNo: number;
      project: { id: string; name: string };
      module: { name: string; responsibility: { kind: string } };
    };
  }>(`/api/tickets/${ticketId}`, fetchJson);
  if (!data?.ticket) return <HeaderSkeleton titleW={6} subtitleW={14} />;
  const { ticket } = data;
  return (
    <div className="flex items-center gap-3">
      <BackLink href={`/projects/${ticket.project.id}`} label="返回项目" />
      <SimplePageHeader
        title={`#${ticket.ticketNo}`}
        subtitle={`${ticket.project.name} · ${KIND_LABEL[ticket.module.responsibility.kind as "PROGRAM" | "DESIGN" | "BUG"]} / ${ticket.module.name}`}
      />
    </div>
  );
}

export function TicketDetailClient({ ticketId }: { ticketId: string }) {
  return (
    <AppShell header={<TicketDetailHeader ticketId={ticketId} />}>
      <TicketDetail ticketId={ticketId} />
    </AppShell>
  );
}
