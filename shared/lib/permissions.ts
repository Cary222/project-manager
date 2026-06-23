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

export function isRoot(role?: UserRole | string | null): boolean {
  return role === UserRole.ROOT || role === "ROOT";
}

export function isBanned(bannedAt: Date | null | undefined): boolean {
  return bannedAt !== null && bannedAt !== undefined;
}

export function canManageUser(
  actorRole?: UserRole | string | null,
  targetRole?: UserRole | string | null
): boolean {
  if (!isRoot(actorRole)) return false;
  return !isRoot(targetRole);
}
