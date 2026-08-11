import { renewLease } from "./jobs";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function startHeartbeat(jobId: string, workerId: string): { stop: () => void } {
  const timer = setInterval(() => {
    renewLease(jobId, workerId).catch((err) =>
      console.error(`[heartbeat] renew failed job=${jobId}`, err),
    );
  }, HEARTBEAT_INTERVAL_MS);

  return {
    stop: () => clearInterval(timer),
  };
}

export async function runWithTimeout<T>(
  jobId: string,
  workerId: string,
  handler: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const heartbeat = startHeartbeat(jobId, workerId);
  try {
    return await Promise.race([
      handler(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Job ${jobId} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  } finally {
    heartbeat.stop();
  }
}
