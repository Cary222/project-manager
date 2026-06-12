import { TicketStatus, UserRole } from "@prisma/client";
import { prisma } from "@/shared/db/client";

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

// --- status-notifications.ts 合并 ---

type NotificationSummary = {
  id: string;
  type: string;
  title: string;
  content: string;
  read: boolean;
  ticketId: string | null;
  ticketNo: number | null;
  actorId: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string;
  } | null;
};

type UserSummary = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
};

export async function getStatusNotificationsForUser(user: UserSummary, limit = 12) {
  const [deliveredHistory, doneHistory] = await Promise.all([
    user.role === "ROOT"
      ? prisma.ticketStatusHistory.findMany({
          where: {
            status: TicketStatus.DELIVERED,
            changedById: { not: user.id },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: {
            changedBy: { select: { id: true, name: true, email: true } },
            ticket: {
              select: {
                id: true,
                ticketNo: true,
                title: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.ticketStatusHistory.findMany({
      where: {
        status: TicketStatus.DONE,
        changedById: { not: user.id },
        ticket: {
          assignees: {
            some: { userId: user.id },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        changedBy: { select: { id: true, name: true, email: true } },
        ticket: {
          select: {
            id: true,
            ticketNo: true,
            title: true,
          },
        },
      },
    }),
  ]);

  const notifications: NotificationSummary[] = [
    ...deliveredHistory.map((item) => ({
      id: `delivered-${item.id}`,
      type: "TICKET_DELIVERED",
      title: `单子 #${item.ticket.ticketNo} 已交付`,
      content: `${item.changedBy.name || item.changedBy.email} 已将「${item.ticket.title}」标记为已交付，等待确认完成。`,
      read: false,
      ticketId: item.ticket.id,
      ticketNo: item.ticket.ticketNo,
      actorId: item.changedBy.id,
      createdAt: item.createdAt.toISOString(),
      actor: item.changedBy,
    })),
    ...doneHistory.map((item) => ({
      id: `done-${item.id}`,
      type: "TICKET_COMPLETED",
      title: `单子 #${item.ticket.ticketNo} 已完成`,
      content: `${item.changedBy.name || item.changedBy.email} 已确认「${item.ticket.title}」完成。`,
      read: false,
      ticketId: item.ticket.id,
      ticketNo: item.ticket.ticketNo,
      actorId: item.changedBy.id,
      createdAt: item.createdAt.toISOString(),
      actor: item.changedBy,
    })),
  ];

  return notifications
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, limit);
}
