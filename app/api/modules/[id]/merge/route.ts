import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoot } from "@/lib/permissions";
import { createModerationLog } from "@/lib/moderation";
import { ModerationAction } from "@prisma/client";

type Params = Promise<{ id: string }>;

export async function POST(request: Request, { params }: { params: Params }) {
  try {
    const session = await requireRoot();
    const { id } = await params;
    const body = (await request.json()) as {
      targetModuleId: string;
      description?: string;
    };

    if (!body.targetModuleId) {
      return NextResponse.json(
        { error: "targetModuleId is required" },
        { status: 400 }
      );
    }

    // 获取源模块
    const sourceModule = await prisma.module.findUnique({ where: { id } });
    if (!sourceModule) {
      return NextResponse.json(
        { error: "Source module not found" },
        { status: 404 }
      );
    }

    // 获取目标模块
    const targetModule = await prisma.module.findUnique({
      where: { id: body.targetModuleId },
    });
    if (!targetModule) {
      return NextResponse.json(
        { error: "Target module not found" },
        { status: 404 }
      );
    }

    // 确认在同一个 Responsibility 下
    if (sourceModule.responsibilityId !== targetModule.responsibilityId) {
      return NextResponse.json(
        { error: "Cannot merge modules from different responsibilities" },
        { status: 400 }
      );
    }

    // 使用事务执行合并
    await prisma.$transaction(async (tx) => {
      // 将源模块的所有单子迁移到目标模块
      await tx.ticket.updateMany({
        where: { moduleId: id },
        data: { moduleId: body.targetModuleId },
      });

      // 更新目标模块描述（如果有提供）
      if (body.description !== undefined) {
        await tx.module.update({
          where: { id: body.targetModuleId },
          data: {
            description: body.description.trim() || null,
          },
        });
      }

      // 删除源模块
      await tx.module.delete({ where: { id } });
    });

    await createModerationLog({
      action: ModerationAction.MERGE_MODULE,
      targetId: id,
      targetType: "Module",
      actorId: session.user.id,
      reason: `合并模块 ${sourceModule.name} 到 ${targetModule.name}`,
    });

    return NextResponse.json({
      success: true,
      mergedInto: {
        id: body.targetModuleId,
        name: targetModule.name,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
