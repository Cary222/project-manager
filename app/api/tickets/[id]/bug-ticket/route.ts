import { NextResponse } from "next/server";
import { ModerationAction, ResponsibilityKind } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { allocateTicketNo } from "@/entities/ticket/lib/ticket-counter";

type BugTicketBody = {
  title?: string;
  description?: string;
  moduleId?: string;
  newModuleName?: string;
  assigneeIds?: string[];
  bugCommitIds?: string[];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as BugTicketBody;
    const ticketNo = Number(id);

    const sourceTicket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: { userId: true },
        },
        module: {
          include: {
            responsibility: true,
          },
        },
        project: {
          include: {
            responsibilities: {
              where: {
                kind: ResponsibilityKind.BUG,
              },
            },
          },
        },
      },
    });

    if (!sourceTicket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    if (sourceTicket.module.responsibility.kind !== "PROGRAM") {
      return NextResponse.json({ error: "source ticket must be PROGRAM type" }, { status: 400 });
    }

    const canUpdate =
      sourceTicket.creatorId === session.user.id ||
      sourceTicket.assignees.some((a) => a.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canUpdate) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    let bugResponsibility = sourceTicket.project.responsibilities[0];
    if (!bugResponsibility) {
      bugResponsibility = await prisma.responsibility.create({
        data: {
          projectId: sourceTicket.projectId,
          kind: ResponsibilityKind.BUG,
        },
      });
    }

    let targetModuleId = body.moduleId;

    // 如果选择了程序模块（传入的是程序模块 ID），则在 Bug 职责下创建同名模块
    if (!targetModuleId && body.newModuleName) {
      // 先检查 Bug 职责下是否已有同名模块
      let existingModule = await prisma.module.findFirst({
        where: {
          responsibilityId: bugResponsibility.id,
          name: body.newModuleName,
        },
      });

      if (existingModule) {
        targetModuleId = existingModule.id;
      } else {
        // 在 Bug 职责下创建新模块
        const newModule = await prisma.module.create({
          data: {
            responsibilityId: bugResponsibility.id,
            name: body.newModuleName,
          },
        });
        targetModuleId = newModule.id;
      }
    }

    // 如果传入了程序模块 ID，需要在 Bug 职责下创建同名模块
    if (targetModuleId && !body.newModuleName) {
      // 获取程序模块名称
      const sourceModule = await prisma.module.findUnique({
        where: { id: targetModuleId },
        include: { responsibility: true },
      });

      if (sourceModule && sourceModule.responsibility.kind === ResponsibilityKind.PROGRAM) {
        // 在 Bug 职责下查找或创建同名模块
        let bugModule = await prisma.module.findFirst({
          where: {
            responsibilityId: bugResponsibility.id,
            name: sourceModule.name,
          },
        });

        if (!bugModule) {
          bugModule = await prisma.module.create({
            data: {
              responsibilityId: bugResponsibility.id,
              name: sourceModule.name,
              description: `源自程序模块: ${sourceModule.name}`,
            },
          });
        }

        targetModuleId = bugModule.id;
      }
    }

    if (!targetModuleId) {
      const defaultModule = await prisma.module.findFirst({
        where: { responsibilityId: bugResponsibility.id },
        orderBy: { createdAt: "asc" },
      });

      if (defaultModule) {
        targetModuleId = defaultModule.id;
      } else {
        const newModule = await prisma.module.create({
          data: {
            responsibilityId: bugResponsibility.id,
            name: "Bug 模块",
          },
        });
        targetModuleId = newModule.id;
      }
    }

    const newTicketNo = await allocateTicketNo();

    const assigneeIds = body.assigneeIds ?? sourceTicket.assignees.map((a) => a.userId);

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo: newTicketNo,
          title: body.title ?? `Bug: ${sourceTicket.title}`,
          description: body.description ?? sourceTicket.description ?? "",
          projectId: sourceTicket.projectId,
          moduleId: targetModuleId,
          creatorId: session.user.id,
          status: "DEVELOPING",
          assignees: {
            create: assigneeIds.map((userId) => ({
              userId,
            })),
          },
        },
      });

      await tx.ticketAssigneeHistory.create({
        data: {
          ticketId: created.id,
          assigneeIds,
          changedById: session.user.id,
        },
      });

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          status: "DEVELOPING",
          changedById: session.user.id,
        },
      });

      return created;
    });

    try {
      await createModerationLog({
        action: ModerationAction.CREATE_TICKET,
        targetId: newTicketNo.toString(),
        targetType: "Ticket",
        actorId: session.user.id,
        reason: `从程序单 #${sourceTicket.ticketNo} 推送 Bug 单`,
      });
    } catch (error) {
      console.error("Failed to create moderation log", error);
    }

    return NextResponse.json({
      bugTicket: {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        title: ticket.title,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
