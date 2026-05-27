const TICKET_WITH_DESC_RE = /^#?(\d{5,})\s*[:：]\s*(.+)$/;
const TICKET_ONLY_RE = /^#?(\d{5,})$/;

export type ParsedTicketCommit = {
  ticketNo: number;
  cleanSubject: string;
};

export function parseTicketCommitSubject(subject: string): ParsedTicketCommit | null {
  const trimmed = subject.trim();
  const withDesc = trimmed.match(TICKET_WITH_DESC_RE);
  if (withDesc) {
    return {
      ticketNo: Number(withDesc[1]),
      cleanSubject: withDesc[2]?.trim() ?? "",
    };
  }

  const onlyNo = trimmed.match(TICKET_ONLY_RE);
  if (onlyNo) {
    return {
      ticketNo: Number(onlyNo[1]),
      cleanSubject: trimmed,
    };
  }

  return null;
}
