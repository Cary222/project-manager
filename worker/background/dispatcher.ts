import type { BackgroundJob } from "@prisma/client";
import type { BackgroundJobType } from "@prisma/client";

export type JobHandler = (job: BackgroundJob, workerId: string) => Promise<void>;

const handlerRegistry = new Map<BackgroundJobType, JobHandler>();

export function registerHandler(type: BackgroundJobType, handler: JobHandler): void {
  handlerRegistry.set(type, handler);
}

export function getHandler(type: BackgroundJobType): JobHandler | undefined {
  return handlerRegistry.get(type);
}

export async function dispatch(job: BackgroundJob, workerId: string): Promise<void> {
  const handler = getHandler(job.type);
  if (!handler) {
    throw new Error(`No handler registered for job type: ${job.type}`);
  }
  await handler(job, workerId);
}
