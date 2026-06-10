import { NextResponse } from "next/server";
import { ResponsibilityKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRoot();
    const { id } = await context.params;
    const body = (await request.json()) as { kind: ResponsibilityKind };
    const kind = body.kind;

    if (!kind) {
      return NextResponse.json({ error: "kind is required" }, { status: 400 });
    }

    if (kind !== ResponsibilityKind.BUG) {
      return NextResponse.json(
        { error: "only BUG kind can be created manually" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }

    const existing = await prisma.responsibility.findUnique({
      where: {
        projectId_kind: {
          projectId: id,
          kind,
        },
      },
    });

    if (existing) {
      return NextResponse.json({ error: "responsibility already exists" }, { status: 409 });
    }

    const responsibility = await prisma.responsibility.create({
      data: {
        projectId: id,
        kind,
      },
      include: {
        modules: true,
      },
    });

    return NextResponse.json({ responsibility });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
