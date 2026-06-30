import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/db/client";
import { requireRoot, requireSession, requireProjectEditor } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction } from "@prisma/client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await context.params;
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        responsibilities: {
          orderBy: { kind: "asc" },
          include: {
            modules: {
              orderBy: { name: "asc" },
              include: {
                tickets: {
                  orderBy: { ticketNo: "desc" },
                  select: {
                    id: true,
                    ticketNo: true,
                    title: true,
                    status: true,
                    deadline: true,
                    assignees: {
                      include: {
                        user: {
                          select: { id: true, name: true, email: true, role: true },
                        },
                      },
                    },
                    commits: {
                      orderBy: { committedAt: "desc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }

    return NextResponse.json({
      project: {
        ...project,
        responsibilities: project.responsibilities.map((responsibility) => ({
          ...responsibility,
          modules: responsibility.modules.map((module) => ({
            ...module,
            tickets: module.tickets.map((ticket) => ({
              id: ticket.id,
              ticketNo: ticket.ticketNo,
              title: ticket.title,
              status: ticket.status,
              deadline: ticket.deadline?.toISOString() ?? null,
              assignees: ticket.assignees.map((item) => item.user),
            })),
          })),
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "MAINTENANCE", "ARCHIVED"]).optional(),
  ownerId: z.string().nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireProjectEditor((await context.params).id);
    const { id } = await context.params;
    const body = await request.json();
    const data = patchSchema.parse(body);

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // ownerId 变更需要事务：同步 Project.ownerId 与 UserOnProject.role
    if (data.ownerId !== undefined && data.ownerId !== project.ownerId) {
      const newOwnerId = data.ownerId;
      const oldOwnerId = project.ownerId;

      // 预先查询新旧负责人姓名（事务外，避免在 tx 内跨表查询）
      const [oldOwner, newOwner] = await Promise.all([
        oldOwnerId ? prisma.user.findUnique({ where: { id: oldOwnerId }, select: { name: true } }) : null,
        newOwnerId ? prisma.user.findUnique({ where: { id: newOwnerId }, select: { name: true } }) : null,
      ]);
      const oldOwnerName = oldOwner?.name ?? oldOwnerId;
      const newOwnerName = newOwner?.name ?? newOwnerId;

      await prisma.$transaction(async (tx) => {
        // 把旧 OWNER（若还在 UserOnProject 中）降为 MEMBER（前提：新旧负责人不是同一人）
        if (oldOwnerId && oldOwnerId !== newOwnerId) {
          const oldOwnerMembership = await tx.userOnProject.findUnique({
            where: { userId_projectId: { userId: oldOwnerId, projectId: id } },
          });
          if (oldOwnerMembership && oldOwnerMembership.role === "OWNER") {
            await tx.userOnProject.update({
              where: { userId_projectId: { userId: oldOwnerId, projectId: id } },
              data: { role: "MEMBER" },
            });
          }
        }

        // 新负责人不在 UserOnProject 中则 upsert，已在则确保 role=OWNER
        if (newOwnerId) {
          await tx.userOnProject.upsert({
            where: { userId_projectId: { userId: newOwnerId, projectId: id } },
            create: { userId: newOwnerId, projectId: id, role: "OWNER" },
            update: { role: "OWNER" },
          });
        }

        // 最后更新 Project.ownerId
        await tx.project.update({
          where: { id },
          data: { ownerId: newOwnerId },
        });

        // 记录负责人变更审计日志
        if (newOwnerId !== oldOwnerId) {
          await tx.moderationLog.create({
            data: {
              action: ModerationAction.CREATE_PROJECT,
              targetId: id,
              targetType: "Project",
              actorId: session.user.id,
              reason: `转移项目负责人: ${oldOwnerName} → ${newOwnerName}`,
            },
          });
        }
      });
    }

    // 其他字段单独更新（不含 ownerId，因为事务已处理）
    const updatedFields: Record<string, unknown> = {};
    if (data.name !== undefined) updatedFields.name = data.name;
    if (data.description !== undefined) updatedFields.description = data.description ?? null;
    if (data.status !== undefined) updatedFields.status = data.status;

    const updated = await prisma.project.update({
      where: { id },
      data: updatedFields,
    });

    await createModerationLog({
      action: ModerationAction.CREATE_PROJECT,
      targetId: id,
      targetType: "Project",
      actorId: session.user.id,
      reason: `更新项目: ${updated.name}`,
    });

    return NextResponse.json({ project: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await prisma.project.delete({ where: { id } });

    await createModerationLog({
      action: ModerationAction.DELETE_PROJECT,
      targetId: id,
      targetType: "Project",
      actorId: session.user.id,
      reason: `删除项目: ${project.name}`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
