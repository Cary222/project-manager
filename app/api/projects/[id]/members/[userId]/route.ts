import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/db/client";
import { requireProjectEditor } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction } from "@prisma/client";

type RouteContext = { params: Promise<{ id: string; userId: string }> };

const patchSchema = z.object({
  role: z.enum(["OWNER", "MEMBER"]),
});

export async function PATCH(
  request: Request,
  context: RouteContext
) {
  try {
    const session = await requireProjectEditor((await context.params).id);
    const { id, userId } = await context.params;
    const body = await request.json();
    const parseResult = patchSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { role } = parseResult.data;

    const membership = await prisma.userOnProject.findUnique({
      where: { userId_projectId: { userId, projectId: id } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (role === "MEMBER" && membership.role === "OWNER") {
      const ownerCount = await prisma.userOnProject.count({
        where: { projectId: id, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "LAST_OWNER" }, { status: 409 });
      }
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });

    await prisma.$transaction(async (tx) => {
      if (role === "OWNER" && membership.role !== "OWNER") {
        await tx.project.update({
          where: { id },
          data: { ownerId: userId },
        });
      }

      await tx.userOnProject.update({
        where: { userId_projectId: { userId, projectId: id } },
        data: { role },
      });

      await createModerationLog({
        action: ModerationAction.CREATE_PROJECT,
        targetId: id,
        targetType: "Project",
        actorId: session.user.id,
        reason: `修改项目成员角色: ${targetUser?.name ?? targetUser?.email ?? userId} → ${role}`,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
