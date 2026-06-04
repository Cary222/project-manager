import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot } from "@/lib/permissions";

type Params = Promise<{ id: string }>;

export async function GET(request: Request, { params }: { params: Params }) {
  try {
    await requireRoot();
    const { id } = await params;
    const module = await prisma.module.findUnique({
      where: { id },
      include: {
        tickets: {
          select: { id: true, ticketNo: true, title: true },
        },
      },
    });
    if (!module) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    return NextResponse.json({ module });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request, { params }: { params: Params }) {
  try {
    await requireRoot();
    const { id } = await params;
    const body = (await request.json()) as {
      name?: string;
      description?: string;
    };

    const existing = await prisma.module.findUnique({
      where: { id },
      include: { _count: { select: { tickets: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    const updateData: { name?: string; description?: string | null } = {};
    if (body.name !== undefined) {
      updateData.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updateData.description = body.description.trim() || null;
    }

    if (body.name && body.name !== existing.name) {
      const conflict = await prisma.module.findUnique({
        where: {
          responsibilityId_name: {
            responsibilityId: existing.responsibilityId,
            name: body.name.trim(),
          },
        },
        include: { _count: { select: { tickets: true } } },
      });
      if (conflict && conflict.id !== id) {
        return NextResponse.json(
          {
            error: "MODULE_CONFLICT",
            message: "此名称已存在，是否合并两个模块？",
            sourceModule: {
              id: existing.id,
              name: existing.name,
              ticketCount: existing._count.tickets,
            },
            targetModule: {
              id: conflict.id,
              name: conflict.name,
              ticketCount: conflict._count.tickets,
            },
          },
          { status: 409 }
        );
      }
    }

    const module = await prisma.module.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ module });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  try {
    await requireRoot();
    const { id } = await params;

    const existing = await prisma.module.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    await prisma.module.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
