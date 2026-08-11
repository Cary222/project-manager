/**
 * Runtime Scheduler — Cron hint + manual trigger
 *
 * 迁移自 features/ai/workflow/scheduler.ts。
 * 支持：
 * - 手动触发（立即生成周报）
 * - Cron 预约（每周五 17:00 自动生成）
 * - 幂等查重（避免重复运行）
 *
 * HMR note: interval 存储在 globalThis，Next.js dev 重载不会重复计时。
 */

import { prisma } from "@/shared/db/client";
import { Prisma } from "@prisma/client";

// ============================================================================
// Constants
// ============================================================================

const TICK_MS = 60_000; // 1 minute
const DEFAULT_WEEKLY_CRON_HINT = "fri 17:00 Asia/Shanghai";

type GlobalScheduler = typeof globalThis & {
  __workflow_scheduler_timer?: ReturnType<typeof setInterval>;
  __workflow_scheduler_started?: boolean;
  __workflow_scheduler_ticking?: boolean;
};

// ============================================================================
// Time Utilities
// ============================================================================

function nextFriday1700(from: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(from);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[lookup.weekday] ?? from.getUTCDay();
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);

  let daysUntilFri = (5 - weekday + 7) % 7;
  if (daysUntilFri === 0 && (hour > 17 || (hour === 17 && minute >= 0))) {
    if (hour > 17 || (hour === 17 && minute > 0)) {
      daysUntilFri = 7;
    } else if (hour === 17 && minute === 0) {
      daysUntilFri = 7;
    }
  }

  const targetLocal = new Date(year, month - 1, day + daysUntilFri);
  return new Date(
    Date.UTC(
      targetLocal.getFullYear(),
      targetLocal.getMonth(),
      targetLocal.getDate(),
      17 - 8, // Beijing 17:00 → UTC = 09:00
      0, 0, 0
    )
  );
}

// ============================================================================
// History Event Helper
// ============================================================================

export function historyEvent(type: string, data?: Record<string, unknown>): { type: string; data?: Record<string, unknown>; ts: string } {
  return { type, data, ts: new Date().toISOString() };
}

// ============================================================================
// Manual Trigger (Plan B-4: 幂等查重)
// ============================================================================

export interface StartManualOptions {
  userId: string;
  userName?: string;
  workflowType: string;
  weekStart?: Date;
  weekEnd?: Date;
  parentScheduleId?: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
}

export interface ManualTriggerResult {
  runId: string;
  threadId: string;
  skipped: boolean; // true if already running
  existingRunId?: string;
}

/**
 * Create a RUN row and start workflow.
 * Idempotent: skips if a running/waiting run already exists for this workflow type.
 */
export async function startWorkflowManually(
  options: StartManualOptions
): Promise<ManualTriggerResult> {
  const threadId = `wf_${options.userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Check existing active run (Plan B-4: 幂等查重)
  const existing = await prisma.workflowRun.findFirst({
    where: {
      userId: options.userId,
      workflowType: options.workflowType,
      kind: "RUN",
      status: { in: ["running", "waiting_review", "pending"] },
    },
  });

  if (existing && existing.threadId) {
    return { runId: existing.id, threadId: existing.threadId, skipped: true, existingRunId: existing.id };
  }

  const run = await prisma.workflowRun.create({
    data: {
      kind: "RUN",
      userId: options.userId,
      workflowType: options.workflowType,
      threadId,
      status: "running",
      parentScheduleId: options.parentScheduleId ?? null,
      conversationId: options.conversationId ?? null,
      metadata: {
        weekStart: options.weekStart?.toISOString(),
        weekEnd: options.weekEnd?.toISOString(),
        userName: options.userName,
        ...options.metadata,
      } as Prisma.InputJsonValue,
      history: historyEvent("run_created", { source: "manual" }) as unknown as Prisma.InputJsonValue,
    },
  });

  return { runId: run.id, threadId, skipped: false };
}

// ============================================================================
// Schedule Management
// ============================================================================

export interface ScheduleOptions {
  userId: string;
  workflowType: string;
  cronHint?: string;
  nextTriggerAt?: Date;
}

export interface ScheduleResult {
  scheduleId: string;
  nextTriggerAt: Date;
}

/**
 * Upsert a schedule for auto-triggering.
 */
export async function scheduleWeeklyReport(
  options: ScheduleOptions
): Promise<ScheduleResult> {
  const nextTriggerAt = options.nextTriggerAt ?? nextFriday1700();
  const cron = options.cronHint ?? DEFAULT_WEEKLY_CRON_HINT;

  // Check existing active schedule
  const existing = await prisma.workflowRun.findFirst({
    where: {
      userId: options.userId,
      workflowType: options.workflowType,
      kind: "SCHEDULE",
      status: { not: "cancelled" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const updated = await prisma.workflowRun.update({
      where: { id: existing.id },
      data: {
        cron,
        nextTriggerAt,
        status: "pending",
        history: [
          ...((Array.isArray(existing.history) ? existing.history : []) as unknown[]),
          historyEvent("schedule_updated", { cron, nextTriggerAt }),
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    return { scheduleId: updated.id, nextTriggerAt };
  }

  const created = await prisma.workflowRun.create({
    data: {
      kind: "SCHEDULE",
      userId: options.userId,
      workflowType: options.workflowType,
      status: "pending",
      cron,
      nextTriggerAt,
      history: historyEvent("schedule_created", { cron, nextTriggerAt }) as unknown as Prisma.InputJsonValue,
    },
  });

  return { scheduleId: created.id, nextTriggerAt };
}

/**
 * Tick all due schedules.
 */
export async function tickSchedules(now: Date = new Date()): Promise<number> {
  const due = await prisma.workflowRun.findMany({
    where: {
      kind: "SCHEDULE",
      status: "pending",
      nextTriggerAt: { lte: now },
    },
    take: 20,
  });

  let fired = 0;
  for (const schedule of due) {
    try {
      // Advance nextTriggerAt first (simple lock)
      const next = nextFriday1700(new Date(now.getTime() + 60_000));
      await prisma.workflowRun.update({
        where: { id: schedule.id },
        data: {
          nextTriggerAt: next,
          history: [
            ...((Array.isArray(schedule.history) ? schedule.history : []) as unknown[]),
            historyEvent("schedule_tick", { at: now.toISOString() }),
          ] as unknown as Prisma.InputJsonValue,
        },
      });

      const user = await prisma.user.findUnique({
        where: { id: schedule.userId },
        select: { name: true },
      });

      await startWorkflowManually({
        userId: schedule.userId,
        userName: user?.name ?? undefined,
        workflowType: schedule.workflowType,
        parentScheduleId: schedule.id,
      });

      fired += 1;
    } catch (err) {
      console.warn(`[runtime/scheduler] tick failed for schedule ${schedule.id}:`, err);
    }
  }
  return fired;
}

// ============================================================================
// Scheduler Lifecycle
// ============================================================================

/**
 * Start the in-process ticker once per process.
 * Safe under Next.js HMR via globalThis guard.
 */
export function ensureSchedulerStarted(): void {
  const g = globalThis as GlobalScheduler;
  if (g.__workflow_scheduler_started) return;
  g.__workflow_scheduler_started = true;

  // Boot compensation pass
  void tickSchedules().catch((err) => {
    console.warn("[runtime/scheduler] boot tick failed:", err);
  });

  if (g.__workflow_scheduler_timer) {
    clearInterval(g.__workflow_scheduler_timer);
  }

  g.__workflow_scheduler_timer = setInterval(() => {
    if (g.__workflow_scheduler_ticking) return;
    g.__workflow_scheduler_ticking = true;
    void tickSchedules()
      .catch((err) => {
        console.warn("[runtime/scheduler] interval tick failed:", err);
      })
      .finally(() => {
        g.__workflow_scheduler_ticking = false;
      });
  }, TICK_MS);

  if (typeof g.__workflow_scheduler_timer.unref === "function") {
    g.__workflow_scheduler_timer.unref();
  }
}
