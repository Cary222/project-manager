/**
 * jobs.ts — IndexJob 公共操作
 *
 * Worker 和 CLI 都可能调用，所以单独抽出。
 */
import { prisma } from "@/shared/db/client";

export const STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000;

export const EXPONENTIAL_BACKOFF_MS = [
  1_000,    // attempt 1 → 1s
  5_000,    // attempt 2 → 5s
  30_000,   // attempt 3 → 30s
  120_000,  // attempt 4 → 2min
  600_000,  // attempt 5 → 10min
];

export function getBackoffDelayMs(nextAttempt: number): number {
  return EXPONENTIAL_BACKOFF_MS[Math.min(nextAttempt - 1, EXPONENTIAL_BACKOFF_MS.length - 1)];
}

/**
 * 把卡在 PROCESSING 状态超过阈值的 job 恢复到 PENDING（attempt + 1）。
 * Worker 启动时和每次轮询时调用。
 */
export async function recoverStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS);
  const { count } = await prisma.indexJob.updateMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "PENDING",
      attempt: { increment: 1 },
      startedAt: null,
    },
  });
  return count;
}

/**
 * 原子抢下一个 PENDING job 并标记为 PROCESSING。
 * 多 worker 并发安全。
 */
export async function claimNextJob() {
  return prisma.$transaction(async (tx) => {
    const found = await tx.indexJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!found) return null;

    return tx.indexJob.update({
      where: {
        id: found.id,
        status: "PENDING",
      },
      data: {
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });
  });
}
