import { prisma } from "@/lib/db";
import { replaceTicketAssignees } from "@/lib/ticket-assignees";

export async function recordAssigneeChange(
  ticketId: string,
  assigneeIds: string[],
  changedById: string
) {
  await replaceTicketAssignees(prisma, ticketId, assigneeIds, changedById);
}
