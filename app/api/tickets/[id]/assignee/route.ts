import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import {
  assigneeUserSelect,
  normalizeAssigneeIds,
  replaceTicketAssignees,
  sameAssigneeIds,
} from "@/entities/ticket/lib/ticket-assignees";
import { requireRoot, requireSession, requireDesignResponsibility } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction, UserRole } from "@prisma/client";
import {
  buildAssignedNotification,
  createManyNotifications,
  listRootUserIds,
} from "@/features/admin/notifications-lib";
import { enqueueIndexJob } from "@/worker/lib/jobs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as { assigneeIds?: string[] };
    const ticketNo = Number(id);
    const nextAssigneeIds = normalizeAssigneeIds(body.assigneeIds ?? []);

    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        assignees: { select: { userId: true } },
        module: { include: { responsibility: { select: { kind: true } } } },
      },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    await requireDesignResponsibility(
      session.user.id,
      current.module.responsibility.kind,
      session.user.role as UserRole
    );

    const currentAssigneeIds = current.assignees.map((item) => item.userId);
    if (sameAssigneeIds(currentAssigneeIds, nextAssigneeIds)) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: current.id },
        include: {
          assignees: {
            include: { user: { select: assigneeUserSelect } },
          },
        },
      });
      return NextResponse.json({
        ticket: ticket
          ? {
              ...ticket,
              assignees: ticket.assignees.map((item) => item.user),
            }
          : null,
      });
    }

    const ticket = await prisma.$transaction(async (tx) => {
      await replaceTicketAssignees(tx, current.id, nextAssigneeIds, session.user.id);
      return tx.ticket.findUnique({
        where: { id: current.id },
        include: {
          assignees: {
            include: { user: { select: assigneeUserSelect } },
          },
        },
      });
    });
    await enqueueIndexJob({ targetType: "TICKET", targetId: current.id });

    const newAssignees = await prisma.user.findMany({
      where: { id: { in: nextAssigneeIds } },
      select: { id: true, name: true, email: true },
    });
    const assigneeNames = newAssignees.map((u) => u.name || u.email).join(", ");

    const addedAssigneeIds = nextAssigneeIds.filter((userId) => !currentAssigneeIds.includes(userId));
    if (addedAssigneeIds.length > 0) {
      const actorName = session.user.name || session.user.email || "管理员";
      const notification = buildAssignedNotification({
        ticketNo: current.ticketNo,
        title: current.title,
        actorName,
      });
      await createManyNotifications({
        userIds: addedAssigneeIds,
        type: "TICKET_ASSIGNED",
        title: notification.title,
        content: notification.content,
        ticketId: current.id,
        actorId: session.user.id,
      });
    }

    const rootUserIds = await listRootUserIds(session.user.id);
    if (rootUserIds.length > 0) {
      await createManyNotifications({
        userIds: rootUserIds,
        type: "TICKET_STATUS_CHANGED",
        title: `单子 #${current.ticketNo} 派单已更新`,
        content: `${session.user.name || session.user.email || "管理员"} 已将「${current.title}」指派为：${assigneeNames || "无人"}`,
        ticketId: current.id,
        actorId: session.user.id,
      });
    }

    await createModerationLog({
      action: ModerationAction.UPDATE_TICKET_ASSIGNEE,
      targetId: current.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `指派变更为 ${assigneeNames || "无人"}`,
    });

    return NextResponse.json({
      ticket: ticket
        ? {
            ...ticket,
            assignees: ticket.assignees.map((item) => item.user),
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
