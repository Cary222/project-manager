import { prisma } from "@/shared/db/client";

export const assigneeUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

export function normalizeAssigneeIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export function sameAssigneeIds(a: string[], b: string[]) {
  const left = normalizeAssigneeIds(a).sort();
  const right = normalizeAssigneeIds(b).sort();
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

type Tx = Pick<
  typeof prisma,
  "ticketAssignee" | "ticketAssigneeHistory"
>;

export async function replaceTicketAssignees(
  tx: Tx,
  ticketId: string,
  assigneeIds: string[],
  changedById: string
) {
  const nextIds = normalizeAssigneeIds(assigneeIds);
  await tx.ticketAssignee.deleteMany({ where: { ticketId } });
  if (nextIds.length > 0) {
    await tx.ticketAssignee.createMany({
      data: nextIds.map((userId) => ({ ticketId, userId })),
    });
  }
  await tx.ticketAssigneeHistory.create({
    data: {
      ticketId,
      assigneeIds: nextIds,
      changedById,
    },
  });
  return nextIds;
}

export async function loadUsersByIds(ids: string[]) {
  const unique = normalizeAssigneeIds(ids);
  if (unique.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: unique } },
    select: assigneeUserSelect,
  });
}

export function mapAssigneeUsers<
  T extends { id: string; name: string | null; email: string; role: string },
>(users: T[], ids: string[]) {
  const map = new Map(users.map((user) => [user.id, user]));
  return ids.map((id) => map.get(id)).filter(Boolean) as T[];
}

export function formatAssigneeList(
  assignees: { name: string | null; email: string; role: string }[]
) {
  if (assignees.length === 0) return "未指派";
  return assignees
    .map((user) => `${user.name || user.email}（${user.role}）`)
    .join("、");
}
