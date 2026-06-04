import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";
import { createModerationLog } from "@/lib/moderation";
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
        responsibilities: {
          orderBy: { kind: "asc" },
          include: {
            modules: {
              orderBy: { name: "asc" },
              include: {
                tickets: {
                  orderBy: { ticketNo: "desc" },
                  include: {
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
              ...ticket,
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
