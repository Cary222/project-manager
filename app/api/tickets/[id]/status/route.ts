import { NextResponse } from "next/server";
import { TicketStatus, ModerationAction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";
import { createModerationLog } from "@/lib/moderation";
import {
  buildCompletedNotification,
  buildDeliveredNotification,
  buildStatusChangedNotification,
  createManyNotifications,
  listRootUserIds,
} from "@/lib/notifications";

const TICKET_STATUS_VALUES = [
  "DEVELOPING",
  "READY_FOR_TEST",
  "DELIVERED",
  "DONE",
] as const satisfies readonly TicketStatus[];

const STATUS_VALUES = new Set<string>(TICKET_STATUS_VALUES);

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DELIVERED: "已交付",
  DONE: "已完成",
};

const USER_ALLOWED_STATUSES = new Set<TicketStatus>([
  TicketStatus.DEVELOPING,
  TicketStatus.READY_FOR_TEST,
  TicketStatus.DELIVERED,
]);

const DESIGN_USER_ALLOWED_STATUSES = new Set<TicketStatus>([
  TicketStatus.DEVELOPING,
  TicketStatus.DELIVERED,
]);

const DESIGN_ALLOWED_STATUSES = new Set<TicketStatus>([
  TicketStatus.DEVELOPING,
  TicketStatus.DELIVERED,
  TicketStatus.DONE,
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (!body.status || !STATUS_VALUES.has(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const ticketNo = Number(id);
    const nextStatus = body.status as TicketStatus;
    const isRoot = session.user.role === "ROOT";

    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        assignees: { select: { userId: true } },
        module: {
          select: {
            responsibility: {
              select: {
                kind: true,
              },
            },
          },
        },
        creatorId: true,
      },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isAssignee = current.assignees.some((item) => item.userId === session.user.id);
    if (!isRoot && !isAssignee) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const isDesignTicket = current.module.responsibility.kind === "DESIGN";

    if (isDesignTicket && !DESIGN_ALLOWED_STATUSES.has(nextStatus)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (!isRoot) {
      const allowedStatuses = isDesignTicket
        ? DESIGN_USER_ALLOWED_STATUSES
        : USER_ALLOWED_STATUSES;
      if (!allowedStatuses.has(nextStatus)) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    }

    if (!isRoot && nextStatus === TicketStatus.DONE) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (current.status === nextStatus) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: current.id },
      });
      return NextResponse.json({ ticket });
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: current.id },
        data: { status: nextStatus },
      });
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: current.id,
          status: nextStatus,
          changedById: session.user.id,
        },
      });
      return updated;
    });

    const actorName = session.user.name || session.user.email || "成员";

    try {
      if (nextStatus === TicketStatus.DELIVERED) {
        const rootUserIds = await listRootUserIds(session.user.id);
        if (rootUserIds.length > 0) {
          const notification = buildDeliveredNotification({
            ticketNo: current.ticketNo,
            title: current.title,
            actorName,
          });
          await createManyNotifications({
            userIds: rootUserIds,
            type: "TICKET_DELIVERED",
            title: notification.title,
            content: notification.content,
            ticketId: current.id,
            actorId: session.user.id,
          });
        }
      } else if (nextStatus === TicketStatus.DONE) {
        const notifyUserIds = [...new Set([
          ...current.assignees.map((item) => item.userId),
          current.creatorId,
        ])].filter((userId) => userId !== session.user.id);
        if (notifyUserIds.length > 0) {
          const notification = buildCompletedNotification({
            ticketNo: current.ticketNo,
            title: current.title,
            actorName,
          });
          await createManyNotifications({
            userIds: notifyUserIds,
            type: "TICKET_COMPLETED",
            title: notification.title,
            content: notification.content,
            ticketId: current.id,
            actorId: session.user.id,
          });
        }
      } else if (isRoot) {
        const assigneeIds = current.assignees
          .map((item) => item.userId)
          .filter((userId) => userId !== session.user.id);
        if (assigneeIds.length > 0) {
          const notification = buildStatusChangedNotification({
            ticketNo: current.ticketNo,
            title: current.title,
            actorName,
            statusLabel: STATUS_LABEL[nextStatus],
          });
          await createManyNotifications({
            userIds: assigneeIds,
            type: "TICKET_STATUS_CHANGED",
            title: notification.title,
            content: notification.content,
            ticketId: current.id,
            actorId: session.user.id,
          });
        }
      }
    } catch (error) {
      console.error("Failed to create status notifications", error);
    }

    try {
      await createModerationLog({
        action: ModerationAction.UPDATE_TICKET_STATUS,
        targetId: current.ticketNo.toString(),
        targetType: "Ticket",
        actorId: session.user.id,
        reason: `状态变更为 ${nextStatus}`,
      });
    } catch (error) {
      console.error("Failed to create status moderation log", error);
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
