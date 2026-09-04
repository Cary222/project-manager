import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import {
  getWorkflowStatus,
  resumeWorkflow,
} from "@/features/ai/agents/work/workflows/weekly-report/approval";
import type { WorkflowHistoryEntry } from "@/features/ai/agents/work/workflows/weekly-report/state";
import { ensureSchedulerStarted } from "@/features/ai/runtime/scheduler";

const resumeSchema = z.object({
  action: z.enum(["message", "approve", "cancel"]),
  message: z.string().max(4000).optional().nullable(),
});

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET  /api/ai/workflows/[id] — status (id = workflowRun id)
 * POST /api/ai/workflows/[id] — resume with { action:"resume", decision, feedback? }
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    ensureSchedulerStarted();
    const session = await requireSession();
    const { id } = await context.params;

    const run = await prisma.workflowRun.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!run) {
      return NextResponse.json(
        { data: null, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (run.kind === "SCHEDULE" || !run.threadId) {
      return NextResponse.json({
        data: {
          run: serializeRun(run),
          snapshot: null,
        },
        error: null,
      });
    }

    const snapshot = await getWorkflowStatus(run.threadId, run.id);

    // Merge DB history (human actions) with graph history (AI steps)
    const dbHistory = (run.history && Array.isArray(run.history)
      ? (run.history as unknown as WorkflowHistoryEntry[])
      : []) as WorkflowHistoryEntry[];
    const graphHistory = (snapshot.values?.history ??
      []) as WorkflowHistoryEntry[];

    // De-duplicate by timestamp+event key; DB entries take priority
    const seenKeys = new Set<string>();
    const mergedHistory: WorkflowHistoryEntry[] = [
      ...dbHistory,
      ...graphHistory.filter((h) => {
        const key = `${h.timestamp}:${h.event}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      }),
    ].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return NextResponse.json({
      data: {
        run: serializeRun(run),
        snapshot: {
          ...snapshot,
          values: snapshot.values
            ? { ...snapshot.values, history: mergedHistory }
            : null,
        },
      },
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await context.params;

    const run = await prisma.workflowRun.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!run) {
      return NextResponse.json(
        { data: null, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // 1. 如果该工作流关联了周报产物 (WeeklyReport)，一并级联删除
    const reportId = (run.metadata as Record<string, unknown> | null)?.reportId as string | undefined;
    if (reportId) {
      await prisma.weeklyReport.deleteMany({
        where: { id: reportId, userId: session.user.id },
      });
    }
    await prisma.weeklyReport.deleteMany({
      where: { workflowRunId: id, userId: session.user.id },
    });

    // 2. 删除 WorkflowRun 记录
    await prisma.workflowRun.delete({ where: { id } });
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    ensureSchedulerStarted();
    const session = await requireSession();
    const { id } = await context.params;
    const body = await request.json();
    const rawAction = body.action as string;

    // Cancel action works for any run kind (RUN or SCHEDULE)
    if (rawAction === "cancel") {
      // ... handle cancel inline
      const run = await prisma.workflowRun.findFirst({
        where: { id, userId: session.user.id },
      });
      if (!run) {
        return NextResponse.json(
          { data: null, error: "NOT_FOUND" },
          { status: 404 }
        );
      }

      await prisma.workflowRun.update({
        where: { id },
        data: {
          status: "cancelled",
          history: [
            ...((Array.isArray(run.history) ? run.history : []) as unknown[]),
            {
              timestamp: new Date().toISOString(),
              event: "review_cancel",
              payload: { source: "cancel_action" },
            },
          ] as unknown as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json({
        data: { run: serializeRun({ ...run, status: "cancelled" }), snapshot: null },
        error: null,
      });
    }

    // Resume (message / approve) only for RUN rows with a thread
    const parsed = resumeSchema.parse(body);

    const run = await prisma.workflowRun.findFirst({
      where: { id, userId: session.user.id, kind: "RUN" },
    });
    if (!run || !run.threadId) {
      return NextResponse.json(
        { data: null, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (parsed.action === "message" && !parsed.message?.trim()) {
      return NextResponse.json(
        { data: null, error: "消息不能为空" },
        { status: 400 }
      );
    }

    const snapshot = await resumeWorkflow(
      run.threadId,
      parsed.action,
      parsed.message ?? null,
      run.id
    );

    const refreshed = await prisma.workflowRun.findUnique({ where: { id: run.id } });

    return NextResponse.json({
      data: {
        run: refreshed ? serializeRun(refreshed) : null,
        snapshot,
      },
      error: null,
    });
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
