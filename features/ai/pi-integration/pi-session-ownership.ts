import "server-only";

import { prisma } from "@/shared/db/client";

export type PiSessionSource = "workspace" | "work_coding";

export async function createPiSessionOwnership(input: {
  piSessionId: string;
  userId: string;
  source: PiSessionSource;
  projectId?: string;
  ticketId?: string;
}) {
  return prisma.piSessionOwnership.upsert({
    where: { piSessionId: input.piSessionId },
    create: input,
    update: { deletedAt: null },
  });
}

/** Returns false rather than leaking whether another user's session exists. */
export async function ownsPiSession(userId: string, piSessionId: string) {
  return Boolean(
    await prisma.piSessionOwnership.findFirst({
      where: { piSessionId, userId, deletedAt: null },
      select: { id: true },
    }),
  );
}

export async function requireOwnedPiSession(
  userId: string,
  piSessionId: string,
) {
  if (!(await ownsPiSession(userId, piSessionId)))
    throw new Error("SESSION_NOT_FOUND");
}

export async function requireOwnedPiSessionIfEnabled(
  userId: string,
  piSessionId: string,
) {
  const { isPiOwnershipEnabled } = await import("./feature-flags");
  if (isPiOwnershipEnabled()) await requireOwnedPiSession(userId, piSessionId);
}

export async function listOwnedPiSessionIds(userId: string) {
  const rows = await prisma.piSessionOwnership.findMany({
    where: { userId, deletedAt: null },
    select: { piSessionId: true },
  });
  return new Set(rows.map((row) => row.piSessionId));
}

export async function retirePiSessionOwnership(
  userId: string,
  piSessionId: string,
) {
  await prisma.piSessionOwnership.updateMany({
    where: { piSessionId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
