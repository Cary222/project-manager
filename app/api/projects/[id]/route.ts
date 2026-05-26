import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";

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
                    assignee: {
                      select: { id: true, name: true, email: true, role: true },
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

    return NextResponse.json({ project });
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
    await requireRoot();
    const { id } = await context.params;
    await prisma.project.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
