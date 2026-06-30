import { UserRole } from "@prisma/client";

/**
 * 检查用户是否为 ROOT。
 * 纯函数，客户端可用。
 */
export function isRoot(role?: UserRole | string | null): boolean {
  return role === UserRole.ROOT || role === "ROOT";
}

/**
 * 检查用户是否被封禁。
 * 纯函数，客户端可用。
 */
export function isBanned(bannedAt: Date | null | undefined): boolean {
  return bannedAt !== null && bannedAt !== undefined;
}

/**
 * 检查操作者是否有权管理目标用户。
 * ROOT 可管理非 ROOT 用户。
 * 纯函数，客户端可用。
 */
export function canManageUser(
  actorRole?: UserRole | string | null,
  targetRole?: UserRole | string | null
): boolean {
  if (!isRoot(actorRole)) return false;
  return !isRoot(targetRole);
}
