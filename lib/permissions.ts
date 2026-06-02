import { UserRole } from "@prisma/client";

export async function requireSession() {
  const session = await import("@/lib/auth").then((m) => m.auth());
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
