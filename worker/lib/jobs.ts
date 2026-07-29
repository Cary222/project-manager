/**
 * jobs.ts — IndexJob 公共操作
 *
 * Worker 和 CLI 都可能调用，所以单独抽出。
 */
import { prisma } from "@/shared/db/client";
import type { IndexJob, IndexJobTargetType as PrismaIndexJobTargetType } from "@prisma/client";

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
 * IndexJob 的通用 target 类型
 */
export type IndexJobTarget =
  | { targetType: "PKM_NOTE"; targetId: string }
  | { targetType: "FILE_ASSET"; targetId: string }
  | { targetType: "TICKET"; targetId: string }
  | { targetType: "COMMIT"; targetId: string };

export async function enqueueIndexJob(target: IndexJobTarget): Promise<string> {
  await prisma.indexJob.deleteMany({
    where: {
      targetType: target.targetType as PrismaIndexJobTargetType,
      targetId: target.targetId,
      status: "PENDING",
    },
  });

  const result = await prisma.indexJob.create({
    data: {
      targetType: target.targetType as PrismaIndexJobTargetType,
      targetId: target.targetId,
      // 向后兼容：PKM_NOTE 时填 noteId
      noteId: target.targetType === "PKM_NOTE" ? target.targetId : null,
      status: "PENDING",
      attempt: 0,
    },
    select: { id: true },
  });

  console.log(`[jobs] enqueued ${target.targetType} index job targetId=${target.targetId} jobId=${result.id}`);
  return result.id;
}

/**
 * @deprecated 请使用 enqueueIndexJob({ targetType: "PKM_NOTE", targetId: noteId })
 */
export async function enqueueIndexJobByNoteId(noteId: string): Promise<string> {
  return enqueueIndexJob({ targetType: "PKM_NOTE", targetId: noteId });
}

/**
 * 把卡在 PROCESSING 状态超过阈值的 job 恢复到 PENDING（attempt + 1）。
 * 恢复时写 updatedAt = now()，使恢复的 job 排到当前队列末尾（按 updatedAt ASC 排序）。
 * 队列公平性由 Worker 重试时的 updatedAt 写入 + claimNextJob 按 updatedAt ASC 排序共同保证；
 * 数据库本身不实现真正的 delayed scheduling，实际退避仍由 Worker sleep(delayMs) 保证。
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
      updatedAt: new Date(),
    },
  });
  return count;
}

/**
 * 原子抢下一个 PENDING job 并标记为 PROCESSING。
 * 按 updatedAt ASC 排序（配合 worker 重试时写 updatedAt = now()），实现队列公平性：
 * 被恢复或重试的 job 写 updatedAt = now() 后自然排到新 jobs 之后。
 * 多 worker 并发安全。
 */
export async function claimNextJob(): Promise<IndexJob | null> {
  return prisma.$transaction(async (tx) => {
    const found = await tx.indexJob.findFirst({
      where: { status: "PENDING" },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
