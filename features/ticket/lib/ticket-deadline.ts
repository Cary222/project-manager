/**
 * Ticket deadline utilities.
 * - computeDefaultDeadline: default deadline based on current week end
 * - isOverdue: check if a ticket is overdue
 */

import { TicketStatus } from "@prisma/client";
import { getWeekRange } from "@/features/weekly-reports/lib/week";

/**
 * Compute default deadline for a new ticket.
 * Returns the end of the current week (Sunday 23:59:59 UTC).
 * If the week ends in less than 24 hours, extend by 1 week.
 */
export function computeDefaultDeadline(now: Date): Date {
  const { weekEnd } = getWeekRange(now);
  const msUntilWeekEnd = weekEnd.getTime() - now.getTime();
  const ONE_DAY_MS = 24 * 3600 * 1000;

  if (msUntilWeekEnd < ONE_DAY_MS) {
    // Extend deadline by 1 week
    return new Date(weekEnd.getTime() + 7 * 24 * 3600 * 1000);
  }

  return weekEnd;
}

/**
 * Check if a ticket is overdue.
 * A ticket is overdue when:
 * - deadline is set
 * - deadline is in the past
 * - status is not one of: DELIVERED, DONE, CLOSED
 */
export function isOverdue(
  ticket: { deadline: Date | null; status: TicketStatus },
  now: Date = new Date()
): boolean {
  if (!ticket.deadline) return false;
  if (ticket.deadline >= now) return false;

  const terminalStatuses: TicketStatus[] = [
    TicketStatus.DELIVERED,
    TicketStatus.DONE,
    TicketStatus.CLOSED,
  ];
  return !terminalStatuses.includes(ticket.status);
}

/**
 * Check if a ticket's deadline is approaching (within 24 hours).
 */
export function isDeadlineApproaching(
  ticket: { deadline: Date | null; status: TicketStatus },
  now: Date = new Date()
): boolean {
  if (!ticket.deadline) return false;

  const terminalStatuses: TicketStatus[] = [
    TicketStatus.DELIVERED,
    TicketStatus.DONE,
    TicketStatus.CLOSED,
    TicketStatus.OVERDUE,
  ];
  if (terminalStatuses.includes(ticket.status)) return false;

  const msUntilDeadline = ticket.deadline.getTime() - now.getTime();
  const ONE_DAY_MS = 24 * 3600 * 1000;

  return msUntilDeadline > 0 && msUntilDeadline <= ONE_DAY_MS;
}
