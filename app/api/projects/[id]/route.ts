import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireRoot, requireSession } from "@/shared/lib/permissions";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      status?: string;
      ownerId?: string | null;
    };

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description ?? null }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
      },
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
