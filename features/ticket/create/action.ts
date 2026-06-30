"use server";

import { ModerationAction, TicketStatus, UserRole } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import {
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
import { syncTicketSearchDocument } from "@/shared/lib/search";

// Auto-start the overdue scanner when this module is first loaded
void import("@/shared/lib/cron-scheduler").catch(() => {});

export type CreateTicketInput = {
  projectId: string;
  moduleId: string;
  title: string;
  description?: string;
  assigneeIds?: string[];
  status?: TicketStatus;
  repoPaths?: string[];
  deadline?: string | Date | null;
};

export type CreateTicketResult =
  | { ok: true; ticket: { id: string; ticketNo: number; title: string } }
  | { ok: false; error: string };

export async function createTicketAction(input: CreateTicketInput): Promise<CreateTicketResult> {
  try {
    const session = await requireSession();

    if (!input.title.trim() || !input.projectId || !input.moduleId) {
      return { ok: false, error: "title, projectId and moduleId are required" };
    }

    const title = input.title.trim();
    const projectId = input.projectId;
    const moduleId = input.moduleId;

    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { responsibility: { select: { kind: true } } },
    });
    if (!module) {
      return { ok: false, error: "module not found" };
    }
    await requireDesignResponsibility(
      session.user.id,
      module.responsibility.kind,
      session.user.role as UserRole
    );

    const ticketNo = await allocateTicketNo();
    const assigneeIds = normalizeAssigneeIds(input.assigneeIds ?? []);

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo,
          title,
          description: input.description?.trim() || null,
          projectId,
          moduleId,
          creatorId: session.user.id,
          status: input.status ?? TicketStatus.DEVELOPING,
          deadline: input.deadline ? new Date(input.deadline) : null,
          repoBindings: {
            create: (input.repoPaths ?? [])
              .filter((repoPath) => repoPath.trim().length > 0)
              .map((repoPath) => ({ repoPath: repoPath.trim() })),
          },
        },
        include: { repoBindings: true },
      });

      await replaceTicketAssignees(tx, created.id, assigneeIds, session.user.id);

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          status: input.status ?? TicketStatus.DEVELOPING,
          changedById: session.user.id,
        },
      });

      return created;
    });

    await syncTicketCounterAfterCreate(ticket.ticketNo);
    // Search embedding is non-critical: run in background so a slow embedding
    // service does not block ticket creation. The search index will catch up
    // on the next sync; failures are logged but never block the user.
    void syncTicketSearchDocument(ticket.id).catch((error) => {
      console.error("syncTicketSearchDocument failed", error);
    });

    if (assigneeIds.length > 0) {
      const actorName = session.user.name || session.user.email || "管理员";
      const notification = buildAssignedNotification({
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        actorName,
      });
      void createManyNotifications({
        userIds: assigneeIds,
        type: "TICKET_ASSIGNED",
        title: notification.title,
        content: notification.content,
        ticketId: ticket.id,
        actorId: session.user.id,
      }).catch((error) => {
        console.error("createManyNotifications failed", error);
      });
    }

    void createModerationLog({
      action: ModerationAction.CREATE_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `创建单子 #${ticket.ticketNo}: ${ticket.title}`,
    }).catch((error) => {
      console.error("createModerationLog failed", error);
    });

    return { ok: true, ticket: { id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { ok: false, error: message };
  }
}

export type CreateBugTicketInput = {
  sourceTicketId: string;
  title: string;
  description?: string;
  /** Module under the BUG responsibility. If omitted, falls back to source ticket's moduleId. */
  moduleId?: string;
  assigneeIds?: string[];
};

export type CreateBugTicketResult =
  | { ok: true; bugTicket: { id: string; ticketNo: number; title: string } }
  | { ok: false; error: string };

export async function createBugTicketAction(
  input: CreateBugTicketInput
): Promise<CreateBugTicketResult> {
  try {
    const session = await requireSession();

    if (!input.title.trim() || !input.sourceTicketId) {
      return { ok: false, error: "title and sourceTicketId are required" };
    }

    const sourceTicket = await prisma.ticket.findUnique({
      where: { id: input.sourceTicketId },
      include: { module: { include: { responsibility: { select: { kind: true } } } } },
    });
    if (!sourceTicket) {
      return { ok: false, error: "source ticket not found" };
    }
    await requireDesignResponsibility(
      session.user.id,
      sourceTicket.module.responsibility.kind,
      session.user.role as UserRole
    );

    const ticketNo = await allocateTicketNo();
    const assigneeIds = normalizeAssigneeIds(input.assigneeIds ?? []);

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          projectId: sourceTicket.projectId,
          moduleId: input.moduleId ?? sourceTicket.moduleId,
          creatorId: session.user.id,
          status: TicketStatus.DEVELOPING,
        },
      });

      await tx.bugProgramBinding.create({
        data: {
          bugTicketId: created.id,
          programTicketId: sourceTicket.id,
          boundById: session.user.id,
        },
      });

      await replaceTicketAssignees(tx, created.id, assigneeIds, session.user.id);

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          status: TicketStatus.DEVELOPING,
          changedById: session.user.id,
        },
      });

      return created;
    });

    await syncTicketCounterAfterCreate(ticket.ticketNo);

    void createModerationLog({
      action: ModerationAction.CREATE_TICKET,
      targetId: ticket.ticketNo.toString(),
      targetType: "Ticket",
      actorId: session.user.id,
      reason: `创建 Bug 单 #${ticket.ticketNo}（来源 #${sourceTicket.ticketNo}）: ${ticket.title}`,
    }).catch((error) => {
      console.error("createModerationLog failed", error);
    });

    return {
      ok: true,
      bugTicket: { id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { ok: false, error: message };
  }
}

export type CreateModuleInput = {
  responsibilityId: string;
  name: string;
};

export type CreateModuleResult =
  | { ok: true; module: { id: string; name: string } }
  | { ok: false; error: string };

export async function createModuleAction(input: CreateModuleInput): Promise<CreateModuleResult> {
  try {
    await requireRoot();

    if (!input.name.trim() || !input.responsibilityId) {
      return { ok: false, error: "name and responsibilityId are required" };
    }

    const module = await prisma.module.create({
      data: {
        responsibilityId: input.responsibilityId,
        name: input.name.trim(),
      },
      select: { id: true, name: true },
    });

    return { ok: true, module };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { ok: false, error: message };
  }
}
