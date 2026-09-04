import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireRoot } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction } from "@prisma/client";

export async function POST(request: Request) {
  try {
    const session = await requireRoot();
    const body = (await request.json()) as {
      responsibilityId?: string;
      name?: string;
      description?: string;
    };
    if (!body.responsibilityId || !body.name?.trim()) {
      return NextResponse.json(
        { error: "responsibilityId and name are required" },
        { status: 400 }
      );
    }

    const name = body.name.trim();
    const mod = await prisma.module.upsert({
      where: {
        responsibilityId_name: {
          responsibilityId: body.responsibilityId,
          name,
        },
      },
      update: {
        description: body.description?.trim() || undefined,
      },
      create: {
        responsibilityId: body.responsibilityId,
        name,
        description: body.description?.trim() || null,
      },
    });

    await createModerationLog({
      action: ModerationAction.CREATE_MODULE,
      targetId: mod.id,
      targetType: "Module",
      actorId: session.user.id,
      reason: `创建模块: ${mod.name}`,
    });

    return NextResponse.json({ module: mod });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
