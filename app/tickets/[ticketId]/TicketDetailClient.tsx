"use client";

import { default as NextDynamic } from "next/dynamic";
import { useEffect } from "react";
import useSWR from "swr";
import { AppShell } from "@/shared/ui/AppShell";
import { BackLink, SimplePageHeader, HeaderSkeleton } from "@/shared/ui/headers";
import { TicketDetailLoading, TicketDetailHeaderSkeleton } from "@/features/ticket/ui/ticket-detail/TicketDetail";
import { fetchJson } from "@/shared/api/fetch-json";
import { KIND_LABEL } from "@/entities/ticket/model/types";
import { useRecentVisits } from "@/shared/lib/visits-context";

const TicketDetail = NextDynamic(
  () => import("@/features/ticket/ui/ticket-detail/TicketDetail").then((m) => m.TicketDetail),
  {
    loading: () => (
        <TicketDetailLoading />
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
  const { data } = useSWR<{
    ticket: {
      ticketNo: number;
      title: string;
      project: { id: string; name: string };
      module: { name: string };
    };
  }>(`/api/tickets/${ticketId}`, fetchJson);
  const { scheduleRecord } = useRecentVisits();

  useEffect(() => {
    if (data?.ticket) {
      const { ticket } = data;
      scheduleRecord({
        projectId: ticket.project.id,
        projectName: ticket.project.name,
        tabKey: "ticket",
        tabLabel: `#${ticket.ticketNo}`,
        ticketId,
        ticketNo: ticket.ticketNo,
        ticketTitle: ticket.title,
      });
    }
  }, [data, scheduleRecord, ticketId]);

  return (
    <AppShell header={<TicketDetailHeader ticketId={ticketId} />}>
      <TicketDetail ticketId={ticketId} />
    </AppShell>
  );
}
