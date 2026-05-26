const TICKET_SUBJECT_RE = /^(\d{5,})\s*[:：]\s*(.+)$/;

export type ParsedTicketCommit = {
  ticketNo: number;
  cleanSubject: string;
};

export function parseTicketCommitSubject(subject: string): ParsedTicketCommit | null {
  const matched = subject.trim().match(TICKET_SUBJECT_RE);
  if (!matched) return null;

  return {
    ticketNo: Number(matched[1]),
    cleanSubject: matched[2]?.trim() ?? "",
  };
}
