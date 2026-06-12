// #10013 / 10013 开头，后面可跟冒号、空格或结束
const TICKET_PREFIX_RE = /^#?(\d{5,})(?:\s*[:：]\s*|\s+)?(.*)$/;

export type ParsedTicketCommit = {
  ticketNo: number;
  cleanSubject: string;
};

export function parseTicketCommitSubject(subject: string): ParsedTicketCommit | null {
  const trimmed = subject.trim();
  const matched = trimmed.match(TICKET_PREFIX_RE);
  if (!matched) return null;

  const ticketNo = Number(matched[1]);
  const cleanSubject = matched[2]?.trim() || trimmed;

  return { ticketNo, cleanSubject };
}
