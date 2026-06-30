import "server-only";

import { UserRole, ResponsibilityKind } from "@prisma/client";
import { prisma } from "@/shared/db/client";

/**
 * 检查用户是否持有指定职能。
 * ROOT 永远返回 true。
 * BUG / PROGRAM 对所有人开放，直接返回 true。
 * DESIGN 需查 UserResponsibility 表。
 */
export async function hasResponsibility(
  userId: string,
  kind: ResponsibilityKind,
  userRole: UserRole
): Promise<boolean> {
  if (userRole === UserRole.ROOT) return true;
  if (kind !== "DESIGN") return true;
  const record = await prisma.userResponsibility.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  return !!record;
}

/**
 * DESIGN 单创建/指派前校验。要求持有 DESIGN 职能。
 * BUG / PROGRAM 跳过校验（已在 hasResponsibility 中处理）。
 */
export async function requireDesignResponsibility(
  userId: string,
  kind: ResponsibilityKind,
  userRole: UserRole
): Promise<void> {
  const allowed = await hasResponsibility(userId, kind, userRole);
  if (!allowed) throw new Error("FORBIDDEN");
}


export async function requireSession() {
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireRoot() {
  const session = await requireSession();
  if (session.user.role !== UserRole.ROOT) {
    throw new Error("FORBIDDEN");
  }
  return session;
}

/**
 * 检查用户是否有权编辑项目（ROOT 或项目 OWNER/MEMBER）。
 * 用于项目详情页的 PATCH、成员增删改操作。
 */
export async function requireProjectEditor(projectId: string) {
  const session = await requireSession();
  if (session.user.role === UserRole.ROOT) return session;

  const membership = await prisma.userOnProject.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId } },
  });
  if (membership) return session;

  throw new Error("FORBIDDEN");
}
