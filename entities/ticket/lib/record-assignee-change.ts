import { prisma } from "@/shared/db/client";
import { replaceTicketAssignees } from "@/entities/ticket/lib/ticket-assignees";

export async function recordAssigneeChange(
  ticketId: string,
  assigneeIds: string[],
  changedById: string
) {
  await replaceTicketAssignees(prisma, ticketId, assigneeIds, changedById);
}
