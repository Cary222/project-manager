import { NextResponse } from "next/server";
import { TicketStatus, ModerationAction } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import {
  assigneeUserSelect,
  loadUsersByIds,
  mapAssigneeUsers,
  normalizeAssigneeIds,
  replaceTicketAssignees,
  sameAssigneeIds,
} from "@/entities/ticket/lib/ticket-assignees";
import { requireRoot, requireSession, requireDesignResponsibility } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { syncTicketCounterAfterDelete } from "@/entities/ticket/lib/ticket-counter";
import { syncTicketSearchDocument } from "@/shared/lib/search";
import {
  buildAssignedNotification,
  buildCompletedNotification,
  buildDeliveredNotification,
  buildStatusChangedNotification,
  createManyNotifications,
  listRootUserIds,
} from "@/features/admin/notifications-lib";

async function enrichAssigneeHistory(
  history: {
    id: string;
    assigneeIds: string[];
    createdAt: Date;
    changedBy: {
      id: string;
      name: string | null;
      email: string;
      role: string;
    };
  }[]
) {
  const allIds = normalizeAssigneeIds(history.flatMap((item) => item.assigneeIds));
  const users = await loadUsersByIds(allIds);
  return history.map((item) => ({
    ...item,
    assignees: mapAssigneeUsers(users, item.assigneeIds),
  }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);
    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        project: {
          include: {
            responsibilities: {
              orderBy: { kind: "asc" },
              include: {
                modules: {
                  orderBy: { name: "asc" },
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        creator: {
          select: { id: true },
        },
        assignees: {
          include: {
            user: { select: assigneeUserSelect },
          },
        },
        module: {
          include: {
            responsibility: true,
          },
        },
        commits: {
          orderBy: { committedAt: "desc" },
        },
        pushSources: {
          include: {
            sourceTicket: {
              select: { id: true, ticketNo: true, title: true },
            },
          },
        },
        bugSources: {
          include: {
            programTicket: {
              select: { id: true, ticketNo: true, title: true },
            },
          },
        },
        assigneeHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            changedBy: { select: assigneeUserSelect },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          include: {
            changedBy: { select: assigneeUserSelect },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const assigneeHistory = await enrichAssigneeHistory(ticket.assigneeHistory);

    // Fetch priority/module change logs from ModerationLog (filtered by ticketNo)
    const moderationLogs = await prisma.moderationLog.findMany({
      where: {
        targetType: "Ticket",
        targetId: ticket.ticketNo.toString(),
        action: { in: [ModerationAction.EDIT_TICKET, ModerationAction.CHANGE_TICKET_MODULE] },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
    });

    return NextResponse.json({
      ticket: {
        ...ticket,
        creatorId: ticket.creator.id,
        assignees: ticket.assignees.map((item) => item.user),
        assigneeHistory,
        pushSources: ticket.pushSources,
        bugSources: ticket.bugSources,
        moderationLogs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const ticketNo = Number(id);

    // 获取单子信息用于审计日志
    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      select: { id: true, ticketNo: true, title: true },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM pm."DesignProgramBinding"
        WHERE "sourceTicketId" = ${ticket.id}
           OR "targetTicketId" = ${ticket.id}
      `;

      await tx.$executeRaw`
        DELETE FROM pm."BugProgramBinding"
        WHERE "bugTicketId" = ${ticket.id}
           OR "programTicketId" = ${ticket.id}
      `;

      await tx.ticket.delete({
        where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      });
    });

    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: "TICKET",
        sourceId: ticket.id,
      },
    });

    await syncTicketCounterAfterDelete();

    // 记录审计日志
    await createModerationLog({
      action: ModerationAction.DELETE_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `删除单子 #${ticket.ticketNo}: ${ticket.title}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: { assignees: { select: { userId: true } } },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isAssignee = ticket.assignees.some(a => a.userId === session.user.id);
    const isRoot = session.user.role === "ROOT";
    if (!isAssignee && !isRoot) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json()) as { title?: string; description?: string };
    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        title: body.title?.trim() || undefined,
        description: body.description !== undefined ? (body.description.trim() || null) : undefined,
      },
    });
    await syncTicketSearchDocument(ticket.id);

    await createModerationLog({
      action: ModerationAction.EDIT_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `编辑单子详情: ${updated.title}`,
    });

    return NextResponse.json({ ticket: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

type PATCHBody = {
  title?: string;
  description?: string;
  status?: TicketStatus;
  assigneeIds?: string[];
  priority?: number;
  moduleId?: string;
};

const STATUS_VALUES = new Set<string>([
  "DEVELOPING", "READY_FOR_TEST", "DELIVERED", "DONE", "OVERDUE", "CLOSED",
]);
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
const ROOT_ONLY_STATUSES = new Set<TicketStatus>([
  TicketStatus.OVERDUE,
  TicketStatus.CLOSED,
]);
const PRIORITY_VALUES = [0, 1, 2, 3] as const;

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DELIVERED: "已交付",
  DONE: "已完成",
  OVERDUE: "已逾期",
  CLOSED: "已关闭",
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as PATCHBody;
    const ticketNo = Number(id);

    const current = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: { select: { userId: true } },
        module: {
          include: {
            responsibility: { select: { kind: true } },
          },
        },
        creator: { select: { id: true } },
      },
    });
    if (!current) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isAssignee = current.assignees.some((a) => a.userId === session.user.id);
    const isRoot = session.user.role === "ROOT";

    // ---- title / description ----
    if ((body.title !== undefined || body.description !== undefined) && !isAssignee && !isRoot) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // ---- status ----
    if (body.status !== undefined) {
      if (!STATUS_VALUES.has(body.status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      if (!isRoot && !isAssignee) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      const nextStatus = body.status as TicketStatus;
      const isDesignTicket = current.module.responsibility.kind === "DESIGN";
      if (isDesignTicket && !DESIGN_ALLOWED_STATUSES.has(nextStatus)) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      if (!isRoot) {
        const allowed = isDesignTicket ? DESIGN_USER_ALLOWED_STATUSES : USER_ALLOWED_STATUSES;
        if (!allowed.has(nextStatus)) {
          return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
        }
      }
      if (!isRoot && ROOT_ONLY_STATUSES.has(nextStatus)) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      if (!isRoot && nextStatus === TicketStatus.DONE) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    }

    // ---- assigneeIds ----
    if (body.assigneeIds !== undefined) {
      await requireDesignResponsibility(
        session.user.id,
        current.module.responsibility.kind,
        session.user.role as "ROOT" | "USER"
      );
    }

    // ---- priority ----
    if (body.priority !== undefined) {
      if (!PRIORITY_VALUES.includes(body.priority as typeof PRIORITY_VALUES[number])) {
        return NextResponse.json({ error: "invalid priority" }, { status: 400 });
      }
      if (!isRoot && !isAssignee) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    }

    // ---- Build update data ----
    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.moduleId !== undefined) updateData.moduleId = body.moduleId;

    let newModule: { name: string } | null = null;
    if (body.moduleId !== undefined) {
      const found = await prisma.module.findUnique({ where: { id: body.moduleId } });
      if (!found) {
        return NextResponse.json({ error: "module not found" }, { status: 404 });
      }
      if (found.responsibilityId !== current.module.responsibilityId) {
        return NextResponse.json(
          { error: "Cannot move ticket to module in different responsibility" },
          { status: 400 }
        );
      }
      newModule = found;
    }

    // Priority update (outside transaction — single field, low concurrency risk)
    if (body.priority !== undefined && current.priority !== body.priority) {
      await prisma.ticket.update({
        where: { id: current.id },
        data: { priority: body.priority },
      });
      await createModerationLog({
        action: ModerationAction.EDIT_TICKET,
        targetId: current.ticketNo.toString(),
        targetType: "Ticket",
        actorId: session.user.id,
        reason: `优先级变更为 P${body.priority}`,
      });
    }

    // Module update (outside transaction — single field, low concurrency risk)
    if (body.moduleId !== undefined && current.moduleId !== body.moduleId) {
      if (!isRoot) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      await prisma.ticket.update({
        where: { id: current.id },
        data: { moduleId: body.moduleId },
      });
      await createModerationLog({
        action: ModerationAction.CHANGE_TICKET_MODULE,
        targetId: current.ticketNo.toString(),
        targetType: "Ticket",
        actorId: session.user.id,
        reason: `移动单子从模块 ${current.module.name} 到 ${newModule?.name ?? body.moduleId}`,
      });
    }

    // Status change — in transaction (update + history)
    if (body.status !== undefined && current.status !== body.status) {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: current.id },
          data: { status: body.status as TicketStatus },
        });
        await tx.ticketStatusHistory.create({
          data: {
            ticketId: current.id,
            status: body.status as TicketStatus,
            changedById: session.user.id,
          },
        });
      });
      await createModerationLog({
        action: ModerationAction.UPDATE_TICKET_STATUS,
        targetId: current.ticketNo.toString(),
        targetType: "Ticket",
        actorId: session.user.id,
        reason: `状态变更为 ${body.status}`,
      });

      const actorName = session.user.name || session.user.email || "成员";

      try {
        if (body.status === TicketStatus.DELIVERED) {
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
        } else if (body.status === TicketStatus.DONE) {
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
              statusLabel: STATUS_LABEL[body.status as TicketStatus],
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
    }

    // Assignee change — in transaction (replace + history)
    if (body.assigneeIds !== undefined) {
      const currentAssigneeIds = current.assignees.map((a) => a.userId);
      const nextAssigneeIds = normalizeAssigneeIds(body.assigneeIds ?? []);
      if (!sameAssigneeIds(currentAssigneeIds, nextAssigneeIds)) {
        await prisma.$transaction(async (tx) => {
          await replaceTicketAssignees(tx, current.id, nextAssigneeIds, session.user.id);
        });
        await createModerationLog({
          action: ModerationAction.UPDATE_TICKET_ASSIGNEE,
          targetId: current.ticketNo.toString(),
          targetType: "Ticket",
          actorId: session.user.id,
          reason: `指派变更为 ${nextAssigneeIds.length === 0 ? "无人" : nextAssigneeIds.join(", ")}`,
        });

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
      }
    }

    // title / description (outside transaction)
    if (Object.keys(updateData).length > 0) {
      await prisma.ticket.update({
        where: { id: current.id },
        data: updateData,
      });
    }

    await syncTicketSearchDocument(current.id);

    // Fetch full ticket with all includes (same pattern as GET)
    const updated = await prisma.ticket.findUnique({
      where: { id: current.id },
      include: {
        project: {
          include: {
            responsibilities: {
              orderBy: { kind: "asc" },
              include: {
                modules: {
                  orderBy: { name: "asc" },
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        creator: { select: { id: true } },
        assignees: {
          include: { user: { select: assigneeUserSelect } },
        },
        module: {
          include: { responsibility: true },
        },
        commits: { orderBy: { committedAt: "desc" } },
        pushSources: {
          include: { sourceTicket: { select: { id: true, ticketNo: true, title: true } } },
        },
        bugSources: {
          include: { programTicket: { select: { id: true, ticketNo: true, title: true } } },
        },
        assigneeHistory: {
          orderBy: { createdAt: "desc" },
          include: { changedBy: { select: assigneeUserSelect } },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
          include: { changedBy: { select: assigneeUserSelect } },
        },
      },
    });

    const enrichedAssigneeHistory = await (async () => {
      const allIds = normalizeAssigneeIds(
        (updated?.assigneeHistory ?? []).flatMap((item) => item.assigneeIds)
      );
      const users = await loadUsersByIds(allIds);
      return (updated?.assigneeHistory ?? []).map((item) => ({
        ...item,
        assignees: mapAssigneeUsers(users, item.assigneeIds),
      }));
    })();

    return NextResponse.json({
      ticket: {
        ...updated,
        creatorId: updated?.creator.id,
        assignees: updated?.assignees.map((item) => item.user) ?? [],
        assigneeHistory: enrichedAssigneeHistory,
        pushSources: updated?.pushSources ?? [],
        bugSources: updated?.bugSources ?? [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
