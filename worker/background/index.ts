/**
 * background/index.ts — BackgroundJob Worker 入口
 * 与 IndexJob worker 平行，不互相干扰。
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import { claimNextBackgroundJob, updateBackgroundJobStatus } from "./jobs";
import { dispatch } from "./dispatcher";
import { runWithTimeout } from "./heartbeat";
import { getPolicy } from "./config/job-policy";
import { registerAllHandlers } from "./handlers/index";

loadEnvConfig(process.cwd());
registerAllHandlers();

const WORKER_ID = `bg-worker-${process.pid}`;
const POLL_INTERVAL_MS = 2_000;
const LOG_PREFIX = "[bg-worker]";

async function processNextJob(): Promise<boolean> {
  const job = await claimNextBackgroundJob(WORKER_ID);
  if (!job) return false;

  const policy = getPolicy(job.type);
  console.log(
    `${LOG_PREFIX} claimed job=${job.id} type=${job.type} attempt=${job.attempt}`,
  );

  try {
    await runWithTimeout(
      job.id,
      WORKER_ID,
      () => dispatch(job, WORKER_ID),
      policy.timeoutMs,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const shouldRetry = job.attempt < policy.maxAttempts;
    if (shouldRetry) {
      const backoffMs =
        policy.backoffMs[Math.min(job.attempt - 1, policy.backoffMs.length - 1)] ?? 5_000;
      await updateBackgroundJobStatus(job.id, "PENDING", {
        errorMessage: msg,
        nextRetryAt: new Date(Date.now() + backoffMs),
      });
      console.warn(
        `${LOG_PREFIX} job=${job.id} failed attempt=${job.attempt}, retry in ${backoffMs}ms`,
      );
    } else {
      await updateBackgroundJobStatus(job.id, "FAILED", { errorMessage: msg });
      console.error(
        `${LOG_PREFIX} job=${job.id} FAILED after ${job.attempt} attempts: ${msg}`,
      );
    }
  }
  return true;
}

async function main(): Promise<void> {
  console.log(`${LOG_PREFIX} starting (pid=${process.pid})`);
  let stopping = false;

  process.on("SIGINT", async () => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  });

  while (!stopping) {
    try {
      const processed = await processNextJob();
      if (!processed) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch (err) {
      console.error(`${LOG_PREFIX} loop error:`, err);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

main().catch(async (err) => {
  console.error(`${LOG_PREFIX} fatal:`, err);
  await prisma.$disconnect();
  process.exit(1);
});
