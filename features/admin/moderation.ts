import { ModerationAction } from "@prisma/client";
import { prisma } from "@/shared/db/client";

type CreateModerationLogParams = {
  action: ModerationAction;
  targetId: string;
  targetType: string;
  actorId: string;
  reason?: string | null;
};

export async function createModerationLog({
  action,
  targetId,
  targetType,
  actorId,
  reason,
}: CreateModerationLogParams) {
  return prisma.moderationLog.create({
    data: { action, targetId, targetType, reason: reason ?? null, actorId },
  });
}

export async function getModerationLogs(limit = 100) {
  const logs = await prisma.moderationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (logs.length === 0) return logs;

  const targetIds = [
    ...new Set(logs.filter((l) => l.targetType === "User").map((l) => l.targetId)),
  ];

  const users =
    targetIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

  const userMap = new Map(users.map((u) => [u.id, u]));

  return logs.map((log) => ({
    ...log,
    target:
      log.targetType === "User" ? userMap.get(log.targetId) ?? null : null,
  }));
}
