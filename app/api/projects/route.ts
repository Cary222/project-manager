import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";
import { ResponsibilityKind } from "@prisma/client";

export async function GET() {
  try {
    await requireSession();
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
      },
    });
    return NextResponse.json({ projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await requireRoot();
    const body = (await request.json()) as { name?: string; description?: string };
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          description: body.description?.trim() || null,
        },
      });

      await tx.responsibility.createMany({
        data: [
          { projectId: created.id, kind: ResponsibilityKind.PROGRAM },
          { projectId: created.id, kind: ResponsibilityKind.DESIGN },
        ],
      });

      return created;
    });

    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
