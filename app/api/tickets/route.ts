import { NextResponse } from "next/server";
import { TicketStatus, ModerationAction, UserRole } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import {
  assigneeUserSelect,
  normalizeAssigneeIds,
  replaceTicketAssignees,
} from "@/entities/ticket/lib/ticket-assignees";
import { requireRoot, requireSession, requireDesignResponsibility } from "@/shared/lib/permissions";
import { allocateTicketNo, syncTicketCounterAfterCreate } from "@/entities/ticket/lib/ticket-counter";
import { createModerationLog } from "@/features/admin/moderation";
import {
  buildAssignedNotification,
  createManyNotifications,
} from "@/features/admin/notifications-lib";
import { enqueueIndexJob } from "@/worker/lib/jobs";

// Auto-start the overdue scanner when this module is first loaded
void import("@/worker/lib/cron-scheduler").catch(() => {});

export async function POST(request: Request) {
  try {
    const session = await requireSession();

    const body = (await request.json()) as {
      title?: string;
      description?: string;
      projectId?: string;
      moduleId?: string;
      assigneeId?: string;
      assigneeIds?: string[];
      status?: TicketStatus;
      repoPaths?: string[];
      deadline?: string | Date | null;
      priority?: number;
    };

    if (!body.title?.trim() || !body.projectId || !body.moduleId) {
      return NextResponse.json(
        { error: "title, projectId and moduleId are required" },
        { status: 400 }
      );
    }

    const title = body.title.trim();
    const projectId = body.projectId;
    const moduleId = body.moduleId;

    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { responsibility: { select: { kind: true } } },
    });
    if (!module) {
      return NextResponse.json({ error: "module not found" }, { status: 404 });
    }
    await requireDesignResponsibility(
      session.user.id,
      module.responsibility.kind,
      session.user.role as UserRole
    );
    const ticketNo = await allocateTicketNo();
    const assigneeIds = normalizeAssigneeIds(
      body.assigneeIds ?? (body.assigneeId ? [body.assigneeId] : [])
    );

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo,
          title,
          description: body.description?.trim() || null,
          projectId,
          moduleId,
          creatorId: session.user.id,
          status: body.status ?? TicketStatus.DEVELOPING,
          deadline: body.deadline ? new Date(body.deadline) : null,
          priority: body.priority ?? 2,
          repoBindings: {
            create: (body.repoPaths ?? [])
              .filter((repoPath) => repoPath.trim().length > 0)
              .map((repoPath) => ({ repoPath: repoPath.trim() })),
          },
        },
        include: { repoBindings: true },
      });

      await replaceTicketAssignees(
        tx,
        created.id,
        assigneeIds,
        session.user.id
      );

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          status: body.status ?? TicketStatus.DEVELOPING,
          changedById: session.user.id,
        },
      });

      return created;
    });

    await syncTicketCounterAfterCreate(ticket.ticketNo);
    await enqueueIndexJob({ targetType: "TICKET", targetId: ticket.id });

    if (assigneeIds.length > 0) {
      const actorName = session.user.name || session.user.email || "管理员";
      const notification = buildAssignedNotification({
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        actorName,
      });
      await createManyNotifications({
        userIds: assigneeIds,
        type: "TICKET_ASSIGNED",
        title: notification.title,
        content: notification.content,
        ticketId: ticket.id,
        actorId: session.user.id,
      });
    }

    await createModerationLog({
      action: ModerationAction.CREATE_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `创建单子 #${ticket.ticketNo}: ${ticket.title}`,
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    const tickets = await prisma.ticket.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { ticketNo: "desc" },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        priority: true,
        project: {
          select: { id: true, name: true },
        },
        module: {
          select: {
            name: true,
            responsibility: { select: { kind: true } },
          },
        },
      },
    });
    return NextResponse.json({ tickets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
