"use client";

import { type Ticket, type TicketCreateUser, type ProgramPushDraft, type TicketCreateResponsibility } from "./types";
import { TicketPushPanel } from "./TicketPushPanel";

type Props = {
  ticket: Ticket;
  users: TicketCreateUser[];
  isRoot: boolean;
  programResponsibility: TicketCreateResponsibility | null;
  programPushDraft: ProgramPushDraft | null;
  onMessage: (msg: string) => void;
};

export function DesignTicketDetail({
  ticket,
  users,
  isRoot,
  programResponsibility,
  programPushDraft,
  onMessage,
}: Props) {
  if (ticket.status !== "DONE") return null;
  if (ticket.creatorId !== ticket.assignees[0]?.id && !isRoot) return null;

  return (
    <TicketPushPanel
      ticketNo={ticket.ticketNo}
      ticketId={ticket.id}
      projectId={ticket.project.id}
      creatorId={ticket.creatorId}
      users={users}
      programResponsibility={programResponsibility}
      programPushDraft={programPushDraft}
      onMessage={onMessage}
      color="emerald"
    />
  );
}
