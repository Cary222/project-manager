import { TicketStatus, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";

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
