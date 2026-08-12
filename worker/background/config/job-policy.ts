import type { BackgroundJobType } from "@prisma/client";

export interface JobPolicy {
  maxAttempts: number;
  timeoutMs: number;
  backoffMs: number[];
}

export const JOB_POLICY: Record<BackgroundJobType, JobPolicy> = {
  IMAGE_GENERATE: {
    maxAttempts: 3,
    timeoutMs: 120_000,
    backoffMs: [1_000, 5_000, 30_000],
  },
  VIDEO_GENERATE: {
    maxAttempts: 3,
    timeoutMs: 600_000, // 10 分钟（异步任务 + 轮询）
    backoffMs: [10_000, 30_000, 60_000],
  },
  DOCUMENT_INDEX: {
    maxAttempts: 5,
    timeoutMs: 600_000,
    backoffMs: [5_000, 30_000, 120_000, 300_000, 600_000],
  },
  TEXT_SUMMARY: {
    maxAttempts: 3,
    timeoutMs: 60_000,
    backoffMs: [1_000, 5_000, 30_000],
  },
};

const DEFAULT_POLICY: JobPolicy = {
  maxAttempts: 3,
  timeoutMs: 300_000,
  backoffMs: [5_000, 30_000, 60_000],
};

export function getPolicy(type: BackgroundJobType): JobPolicy {
  return JOB_POLICY[type] ?? DEFAULT_POLICY;
}
