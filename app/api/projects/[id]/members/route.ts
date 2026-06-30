import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/shared/db/client";
import { requireSession, requireProjectEditor } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { ModerationAction } from "@prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: RouteContext
) {
  try {
    await requireSession();
    const { id } = await context.params;

    const [members, candidates] = await Promise.all([
      prisma.userOnProject.findMany({
        where: { projectId: id },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      }),
      prisma.user.findMany({
        where: {
          bannedAt: null,
          NOT: { userOnProjects: { some: { projectId: id } } },
        },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({ members, candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["OWNER", "MEMBER"]).optional().default("MEMBER"),
});

export async function POST(
  request: Request,
  context: RouteContext
) {
  try {
    const session = await requireProjectEditor((await context.params).id);
    const { id } = await context.params;
    const body = await request.json();
    const parseResult = addMemberSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { userId, role } = parseResult.data;

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const existing = await prisma.userOnProject.findUnique({
      where: { userId_projectId: { userId, projectId: id } },
    });
    if (existing) {
      return NextResponse.json({ error: "MEMBER_EXISTS" }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userOnProject.create({
        data: { userId, projectId: id, role },
      });

      await createModerationLog({
        action: ModerationAction.CREATE_PROJECT,
        targetId: id,
        targetType: "Project",
        actorId: session.user.id,
        reason: `添加项目成员: ${targetUser.name ?? targetUser.email}`,
      });
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext
) {
  try {
    const session = await requireProjectEditor((await context.params).id);
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const membership = await prisma.userOnProject.findUnique({
      where: { userId_projectId: { userId, projectId: id } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (membership.role === "OWNER") {
      const ownerCount = await prisma.userOnProject.count({
        where: { projectId: id, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "LAST_OWNER" }, { status: 409 });
      }
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });

    await prisma.$transaction(async (tx) => {
      await tx.userOnProject.delete({
        where: { userId_projectId: { userId, projectId: id } },
      });

      await createModerationLog({
        action: ModerationAction.DELETE_PROJECT,
        targetId: id,
        targetType: "Project",
        actorId: session.user.id,
        reason: `移除项目成员: ${targetUser?.name ?? targetUser?.email ?? userId}`,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
