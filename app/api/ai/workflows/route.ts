import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import {
  ensureSchedulerStarted,
  scheduleWeeklyReport,
} from "@/features/ai/runtime/scheduler";
import { WEEKLY_REPORT_WORKFLOW_TYPE } from "@/features/ai/agents/work/workflows/weekly-report/graph";
import {
  startWorkflowByType,
  type StartWorkflowResult,
} from "@/features/ai/agents/work/workflows/start";

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
 * 按类型启动工作流。
 *
 * 实现已抽到 `features/ai/agents/work/workflows/start.ts`，
 * 以便 `/api/ai/work/run` 在 Decision 判定为 workflow 模式时复用**同一份**启动逻辑
 * （Next.js route 文件不能导出非 HTTP 方法，所以必须外置）。
 * 此处的行为与抽出前完全一致：幂等、skipped 语义、fire-and-forget。
 */
async function startWorkflow(options: {
  userId: string;
  userName?: string;
  workflowType: SupportedWorkflowType;
  weekStart?: Date;
  weekEnd?: Date;
  parentScheduleId?: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
  forceRestart?: boolean;
}): Promise<StartWorkflowResult> {
  return startWorkflowByType(options);
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
