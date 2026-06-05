import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

export type NotificationTypeValue =
  | "TICKET_ASSIGNED"
  | "TICKET_DELIVERED"
  | "TICKET_COMPLETED"
  | "TICKET_STATUS_CHANGED";

type NotificationDelegate = {
  create: (...args: unknown[]) => Promise<unknown>;
  createMany: (...args: unknown[]) => Promise<unknown>;
};

function getNotificationDelegate() {
  const delegate = (prisma as typeof prisma & {
    notification?: NotificationDelegate;
  }).notification;

  return delegate ?? null;
}

type CreateNotificationInput = {
  userId: string;
  type: NotificationTypeValue;
  title: string;
  content: string;
  ticketId?: string | null;
  actorId?: string | null;
};

type BulkNotificationInput = {
  userIds: string[];
  type: NotificationTypeValue;
  title: string;
  content: string;
  ticketId?: string | null;
  actorId?: string | null;
};

export async function createNotification(input: CreateNotificationInput) {
  const notification = getNotificationDelegate();
  if (!notification) return null;

  return notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      content: input.content,
      ticketId: input.ticketId ?? null,
      actorId: input.actorId ?? null,
    },
  });
}

export async function createManyNotifications(input: BulkNotificationInput) {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (userIds.length === 0) return;

  const notification = getNotificationDelegate();
  if (!notification) return;

  await notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      content: input.content,
      ticketId: input.ticketId ?? null,
      actorId: input.actorId ?? null,
    })),
  });
}

export async function listRootUserIds(excludeUserId?: string) {
  const roots = await prisma.user.findMany({
    where: {
      role: UserRole.ROOT,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });

  return roots.map((user) => user.id);
}

export function buildAssignedNotification(params: {
  ticketNo: number;
  title: string;
  actorName: string;
}) {
  return {
    title: `你被指派了单子 #${params.ticketNo}`,
    content: `${params.actorName} 将你指派到「${params.title}」`,
  };
}

export function buildDeliveredNotification(params: {
  ticketNo: number;
  title: string;
  actorName: string;
}) {
  return {
    title: `单子 #${params.ticketNo} 已交付`,
    content: `${params.actorName} 已将「${params.title}」标记为已交付，等待确认完成。`,
  };
}

export function buildCompletedNotification(params: {
  ticketNo: number;
  title: string;
  actorName: string;
}) {
  return {
    title: `单子 #${params.ticketNo} 已完成`,
    content: `${params.actorName} 已确认「${params.title}」完成。`,
  };
}

export function buildStatusChangedNotification(params: {
  ticketNo: number;
  title: string;
  actorName: string;
  statusLabel: string;
}) {
  return {
    title: `单子 #${params.ticketNo} 状态更新`,
    content: `${params.actorName} 将「${params.title}」更新为${params.statusLabel}。`,
  };
}
