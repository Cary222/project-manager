"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { getStatusNotificationsForUser } from "@/features/admin/notifications-lib";

type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  content: string;
  read: boolean;
  ticketId: string | null;
  actorId: string | null;
  createdAt: Date;
  actor: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  ticket: {
    id: string;
    ticketNo: number;
  } | null;
};

function getNotificationDelegate() {
  const delegate = (prisma as typeof prisma & {
    notification?: {
      findMany: (...args: unknown[]) => Promise<NotificationRecord[]>;
      count: (...args: unknown[]) => Promise<number>;
      updateMany: (...args: unknown[]) => Promise<unknown>;
    };
  }).notification;

  return delegate ?? null;
}

export type NotificationListItem = {
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

export async function getNotificationsAction(limit = 12) {
  const session = await requireSession();
  const notification = getNotificationDelegate();

  if (!notification) {
    return getStatusNotificationsForUser(
      {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? "",
        role: session.user.role,
      },
      limit
    );
  }

  const notifications = await notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, name: true, email: true } },
      ticket: { select: { id: true, ticketNo: true } },
    },
  });

  return notifications.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content,
    read: item.read,
    ticketId: item.ticketId,
    ticketNo: item.ticket?.ticketNo ?? null,
    actorId: item.actorId,
    createdAt: item.createdAt.toISOString(),
    actor: item.actor,
  })) as NotificationListItem[];
}

export async function getUnreadNotificationCountAction() {
  const session = await requireSession();
  const notification = getNotificationDelegate();

  if (!notification) {
    const notifications = await getStatusNotificationsForUser(
      {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? "",
        role: session.user.role,
      },
      50
    );
    return notifications.length;
  }

  const count = await notification.count({
    where: { userId: session.user.id, read: false },
  });

  return count;
}

export async function markNotificationReadAction(notificationId: string) {
  const session = await requireSession();
  const notification = getNotificationDelegate();

  if (!notification) {
    return { success: true };
  }

  await notification.updateMany({
    where: {
      id: notificationId,
      userId: session.user.id,
    },
    data: { read: true },
  });

  revalidatePath("/");
  return { success: true };
}

export async function markAllNotificationsReadAction() {
  const session = await requireSession();
  const notification = getNotificationDelegate();

  if (!notification) {
    return { success: true };
  }

  await notification.updateMany({
    where: {
      userId: session.user.id,
      read: false,
    },
    data: { read: true },
  });

  revalidatePath("/");
  return { success: true };
}
