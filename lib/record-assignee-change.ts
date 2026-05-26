import { prisma } from "@/lib/db";

export async function recordAssigneeChange(
  ticketId: string,
  assigneeId: string | null,
  changedById: string
) {
  await prisma.ticketAssigneeHistory.create({
    data: {
      ticketId,
      assigneeId,
      changedById,
    },
  });
}
