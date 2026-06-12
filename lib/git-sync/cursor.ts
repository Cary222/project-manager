import { prisma } from "@/shared/db/client";

export async function getSyncCursor(repoPath: string) {
  return prisma.syncCursor.findUnique({ where: { repoPath } });
}

export async function listAllSyncCursors() {
  return prisma.syncCursor.findMany({ orderBy: { updatedAt: "desc" } });
}
