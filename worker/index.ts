/**
 * index.ts — project-manager 异步索引 Worker 入口
 *
 * 职责：
 *   1. 从 pm.IndexJob 表轮询 PENDING 状态的 job
 *   2. 根据 targetType 分派到对应的处理函数
 *   3. 处理失败时按指数退避重试（1s/5s/30s/2min/10min），最多 5 次
 *   4. 启动时清理卡在 PROCESSING 状态的 stale job（> 5 分钟）
 *
 * targetType 处理：
 *   - PKM_NOTE: 调用 syncPkmNoteSearchDocumentFull(noteId) 完整索引
 *   - FILE_ASSET: 占位（Feature 2 实现）
 *   - TICKET: 占位（Feature 2 实现）
 *
 * 启动：
 *   npm run worker               # 开发
 *   npm run worker:prod          # 生产（NODE_ENV=production）
 *
 * 部署：
 *   systemctl --user enable --now project-manager-worker.service
 *   见 worker/project-manager-worker.service 和 docs/vector-search/PKM异步索引改造-详细计划.md
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import { syncPkmNoteSearchDocumentFull } from "@/shared/lib/search";
import { processFileAssetJob } from "@/shared/lib/document";
import { claimNextJob, getBackoffDelayMs, recoverStaleJobs } from "@/shared/lib/jobs";

loadEnvConfig(process.cwd());

const POLL_INTERVAL_MS = 2_000;
const LOG_PREFIX = "[worker]";

async function processNextJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  console.log(
    `${LOG_PREFIX} job ${job.id} target=${job.targetType}:${job.targetId} attempt=${job.attempt + 1}/${job.maxAttempts}`,
  );

  try {
    if (job.targetType === "PKM_NOTE") {
      // 向后兼容：优先用 noteId（老数据），没有则用 targetId
      const noteId = job.noteId ?? job.targetId;
      const chunks = await syncPkmNoteSearchDocumentFull(noteId);
      await prisma.indexJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          error: null,
        },
      });
      console.log(
        `${LOG_PREFIX} job ${job.id} completed (${chunks?.length ?? 0} chunks indexed)`,
      );
    } else if (job.targetType === "FILE_ASSET") {
      // Feature 2: process FileAsset → Document → SearchDocument
      await processFileAssetJob(job.targetId);
      await prisma.indexJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          error: null,
        },
      });
      console.log(
        `${LOG_PREFIX} job ${job.id} FILE_ASSET indexing completed`,
      );
    } else if (job.targetType === "TICKET") {
      // Feature 2 实现 ticket indexing
      console.warn(`[worker] job ${job.id} TICKET indexing not implemented yet`);
      await prisma.indexJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          error: "not_implemented",
        },
      });
    }

    return true;
  } catch (error) {
    await handleJobError(job, error);
    return true;
  }
}

async function handleJobError(
  job: { id: string; targetType: string; targetId: string; attempt: number; maxAttempts: number },
  error: unknown,
): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  const nextAttempt = job.attempt + 1;

  if (nextAttempt >= job.maxAttempts) {
    await prisma.indexJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: msg,
        attempt: nextAttempt,
      },
    });
    console.error(
      `${LOG_PREFIX} job ${job.id} (${job.targetType}:${job.targetId}) FAILED after ${job.maxAttempts} attempts: ${msg}`,
    );
    return;
  }

  const delayMs = getBackoffDelayMs(nextAttempt);
  console.warn(
    `${LOG_PREFIX} job ${job.id} (${job.targetType}:${job.targetId}) attempt ${nextAttempt}/${job.maxAttempts} failed: ${msg}. Retry in ${delayMs}ms`,
  );

  await prisma.indexJob.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      attempt: nextAttempt,
      error: msg,
      startedAt: null,
      updatedAt: new Date(Date.now() + delayMs),
    },
  });

  await sleep(delayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`${LOG_PREFIX} starting (pid=${process.pid})`);
  const recovered = await recoverStaleJobs();
  if (recovered > 0) {
    console.warn(`${LOG_PREFIX} recovered ${recovered} stale PROCESSING jobs`);
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${LOG_PREFIX} received ${signal}, shutting down...`);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  while (!stopping) {
    try {
      const processed = await processNextJob();
      if (!processed) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} unexpected loop error:`, error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

main().catch(async (error) => {
  console.error(`${LOG_PREFIX} fatal:`, error);
  await prisma.$disconnect();
  process.exit(1);
});
