import { prisma } from "@/shared/db/client";
import type { BackgroundJob, BackgroundJobStatus, BackgroundJobType } from "@prisma/client";

const LEASE_DURATION_MS = 5 * 60 * 1000;

export interface EnqueueParams {
  type: BackgroundJobType;
  payload: Record<string, unknown>;
  priority?: number;
  correlationId?: string;
  traceId?: string;
}

export async function enqueueBackgroundJob(params: EnqueueParams): Promise<string> {
  const job = await prisma.backgroundJob.create({
    data: {
      type: params.type,
      status: "PENDING",
      payload: JSON.parse(JSON.stringify(params.payload)),
      priority: params.priority ?? 10,
      correlationId: params.correlationId,
      traceId: params.traceId,
    },
    select: { id: true },
  });
  return job.id;
}

export async function claimNextBackgroundJob(workerId: string): Promise<BackgroundJob | null> {
  // 原子 claim：同时覆盖 PENDING 和租约过期的 PROCESSING
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() + LEASE_DURATION_MS);
  const results = await prisma.$queryRaw<BackgroundJob[]>`
    UPDATE "pm"."BackgroundJob"
    SET
      status = 'PROCESSING',
      "lockedBy" = ${workerId},
      "leaseExpiresAt" = ${leaseExpiry},
      attempt = attempt + 1,
      "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "pm"."BackgroundJob"
      WHERE
        (status = 'PENDING' AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= NOW()))
        OR (status = 'PROCESSING' AND "leaseExpiresAt" < NOW())
      ORDER BY priority DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;
  return results[0] ?? null;
}

export async function renewLease(jobId: string, workerId: string): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: { id: jobId, lockedBy: workerId },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) },
  });
}

export async function updateBackgroundJobStatus(
  jobId: string,
  status: BackgroundJobStatus,
  extra?: { result?: Record<string, unknown>; errorMessage?: string; nextRetryAt?: Date }
): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status,
      result: extra?.result ? JSON.parse(JSON.stringify(extra.result)) : undefined,
      errorMessage: extra?.errorMessage,
      nextRetryAt: extra?.nextRetryAt,
      lockedBy: ["COMPLETED", "FAILED", "CANCELLED"].includes(status) ? null : undefined,
      leaseExpiresAt: ["COMPLETED", "FAILED", "CANCELLED"].includes(status) ? null : undefined,
    },
  });
}
