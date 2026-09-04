import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import {
  ensureSchedulerStarted,
  scheduleWeeklyReport,
  startWorkflowManually,
} from "@/features/ai/runtime/scheduler";
import { WEEKLY_REPORT_WORKFLOW_TYPE } from "@/features/ai/agents/work/workflows/weekly-report/graph";
import { startWorkflowAsync } from "@/features/ai/agents/work/workflows/weekly-report/approval";
import { getWeekRange } from "@/features/weekly-reports/lib/week";
import { generateProjectProgressSummary } from "@/features/ai/agents/work/workflows/project-progress/generate-progress-summary";

// Supported workflow types
const WORKFLOW_TYPES = ["weekly_report", "project-progress"] as const;
type SupportedWorkflowType = typeof WORKFLOW_TYPES[number];

const startSchema = z.object({
  workflowType: z.enum(WORKFLOW_TYPES),
  weekStart: z.string().datetime().optional(),
  weekEnd: z.string().datetime().optional(),
  /** If true, only register a SCHEDULE (no immediate RUN). */
  scheduleOnly: z.boolean().optional(),
  cronHint: z.string().optional(),
  nextTriggerAt: z.string().datetime().optional(),
  /** If true, cancel any existing active run before starting a new one */
  forceRestart: z.boolean().optional(),
  /** Optional conversation ID to link this workflow to */
  conversationId: z.string().optional(),
});

/**
 * GET /api/ai/workflows — list current user's RUN (and optional SCHEDULE) rows
 * POST /api/ai/workflows — start workflow RUN (or register SCHEDULE)
 *
 * Side effect: ensureSchedulerStarted() on each request (idempotent, HMR-safe).
 */
export async function GET(request: NextRequest) {
  try {
    ensureSchedulerStarted();
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind"); // SCHEDULE | RUN | null=all
    const limitRaw = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;

    const runs = await prisma.workflowRun.findMany({
      where: {
        userId: session.user.id,
        ...(kind === "SCHEDULE" || kind === "RUN" ? { kind } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      data: runs.map(serializeRun),
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

/**
 * Start a workflow by type.
 * Currently supports: weekly_report
 * Future: other workflow types via registry
 *
 * Uses async start (fire-and-forget) so the POST returns immediately
 * without waiting for HIL interrupts.
 *
 * Optionally links the workflow to an existing conversation.
 */
async function startWorkflow(
  options: {
    userId: string;
    userName?: string;
    workflowType: SupportedWorkflowType;
    weekStart?: Date;
    weekEnd?: Date;
    parentScheduleId?: string;
    metadata?: Record<string, unknown>;
    conversationId?: string;
    /** If true, cancel any existing active run before starting a new one */
    forceRestart?: boolean;
  }
): Promise<{ runId: string; threadId: string; skipped: boolean; existingRunId?: string; conversationId?: string }> {
  const workflowType = options.workflowType;

  // If forceRestart, cancel existing active runs first
  if (options.forceRestart) {
    await prisma.workflowRun.updateMany({
      where: {
        userId: options.userId,
        workflowType: options.workflowType,
        kind: "RUN",
        status: { in: ["running", "waiting_review", "pending"] },
      },
      data: { status: "cancelled" },
    });
  }

  // Use scheduler's idempotent start with conversationId
  const result = await startWorkflowManually({
    ...options,
    conversationId: options.conversationId,
  });

  if (result.skipped) {
    return result;
  }

  // Start the workflow asynchronously (fire-and-forget).
  // Does NOT block — returns immediately even if the graph hits HIL.
  if (workflowType === WEEKLY_REPORT_WORKFLOW_TYPE) {
    const now = new Date();
    const fallbackRange = getWeekRange(now);
    const weekStart = options.weekStart ?? fallbackRange.weekStart;
    const weekEnd = options.weekEnd ?? now;
    
    await startWorkflowAsync({
      userId: options.userId,
      userName: options.userName,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      workflowRunId: result.runId,
      threadId: result.threadId,
    });
  } else if (workflowType === "project-progress") {
    void (async () => {
      try {
        await generateProjectProgressSummary(result.runId, options.userId);
      } catch (e) {
        console.error("[project-progress] generation failed:", e);
        await prisma.workflowRun.update({
          where: { id: result.runId },
          data: { status: "failed", metadata: { error: e instanceof Error ? e.message : "汇总失败" } },
        });
      }
    })();
  }

  return { ...result, conversationId: options.conversationId };
}

export async function POST(request: NextRequest) {
  try {
    ensureSchedulerStarted();
    const session = await requireSession();
    const body = await request.json();
    const parsed = startSchema.parse(body);

    if (parsed.scheduleOnly) {
      // Only scheduleWeeklyReport supports scheduling for now
      if (parsed.workflowType !== WEEKLY_REPORT_WORKFLOW_TYPE) {
        return NextResponse.json(
          { data: null, error: "Scheduling not supported for this workflow type" },
          { status: 400 }
        );
      }

      const { scheduleId, nextTriggerAt } = await scheduleWeeklyReport({
        userId: session.user.id,
        workflowType: parsed.workflowType,
        cronHint: parsed.cronHint,
        nextTriggerAt: parsed.nextTriggerAt
          ? new Date(parsed.nextTriggerAt)
          : undefined,
      });
      return NextResponse.json(
        {
          data: {
            scheduleId,
            nextTriggerAt: nextTriggerAt.toISOString(),
            workflowType: parsed.workflowType,
          },
          error: null,
        },
        { status: 201 }
      );
    }

    // Start workflow manually
    const weekStart = parsed.weekStart
      ? new Date(parsed.weekStart)
      : undefined;
    const weekEnd = parsed.weekEnd ? new Date(parsed.weekEnd) : undefined;

    const result = await startWorkflow({
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      workflowType: parsed.workflowType,
      weekStart,
      weekEnd,
      forceRestart: parsed.forceRestart,
      conversationId: parsed.conversationId,
    });

    if (result.skipped) {
      return NextResponse.json(
        {
          data: {
            runId: result.runId,
            skipped: true,
            existingRunId: result.existingRunId,
            message: "Already running",
          },
          error: null,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        data: {
          runId: result.runId,
          threadId: result.threadId,
          conversationId: result.conversationId,
          workflowType: parsed.workflowType,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

function serializeRun(run: {
  id: string;
  kind: string;
  userId: string;
  workflowType: string;
  threadId: string | null;
  status: string;
  cron: string | null;
  nextTriggerAt: Date | null;
  metadata: unknown;
  history: unknown;
  parentScheduleId: string | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...run,
    nextTriggerAt: run.nextTriggerAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
