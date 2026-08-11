/**
 * Weekly Report Workflow — Approval Entry Points
 *
 * interrupt / resume wrappers for workflow graphs.
 * 迁移自 features/ai/workflow/approval.ts
 */

import { Command, isInterrupted, INTERRUPT } from "@langchain/langgraph";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { getWeeklyReportGraph, WEEKLY_REPORT_WORKFLOW_TYPE } from "./graph";
import { WorkflowStateAnnotation, historyEvent } from "./state";
import type { WorkflowState } from "./state";
import type { ReviewResumeValue } from "./nodes";
import type { WorkflowHistoryEntry } from "./state";

// Re-export types for external consumers (defined below)

export interface StartWorkflowInput {
  userId: string;
  userName?: string;
  weekStart: string;
  weekEnd: string;
  workflowRunId?: string;
  threadId?: string;
}

export interface WorkflowSnapshot {
  threadId: string;
  status: string;
  interrupted: boolean;
  interruptPayload: unknown | null;
  values: Partial<WorkflowState> | null;
  reportId: string | null;
  error: string | null;
  workflowRunId: string | null;
}

function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

function extractInterruptPayload(result: unknown): unknown | null {
  if (isInterrupted(result)) {
    const payload = (result as Record<typeof INTERRUPT, unknown>)[INTERRUPT];
    if (Array.isArray(payload) && payload.length > 0) {
      const first = payload[0] as { value?: unknown };
      return first?.value ?? first ?? payload;
    }
    return payload ?? null;
  }
  return null;
}

async function syncRunStatus(
  workflowRunId: string | null | undefined,
  patch: {
    status: string;
    historyAppend?: ReturnType<typeof historyEvent>;
    metadata?: Record<string, unknown>;
  }
) {
  if (!workflowRunId) return;
  try {
    const existing = await prisma.workflowRun.findUnique({
      where: { id: workflowRunId },
      select: { history: true, metadata: true },
    });
    if (!existing) return;

    const prevHistory = Array.isArray(existing.history)
      ? (existing.history as unknown[])
      : [];
    const nextHistory = patch.historyAppend
      ? [...prevHistory, ...patch.historyAppend]
      : prevHistory;

    const prevMeta =
      existing.metadata && typeof existing.metadata === "object"
        ? (existing.metadata as Record<string, unknown>)
        : {};

    await prisma.workflowRun.update({
      where: { id: workflowRunId },
      data: {
        status: patch.status,
        history: nextHistory as unknown as Prisma.InputJsonValue,
        metadata: patch.metadata
          ? ({ ...prevMeta, ...patch.metadata } as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  } catch (err) {
    console.warn("[workflow/approval] syncRunStatus failed:", err);
  }
}

/**
 * Start workflow synchronously — blocks until done or interrupted.
 * For background/async startup use startWorkflowAsync below.
 */
export async function startWeeklyReportWorkflow(
  input: StartWorkflowInput
): Promise<WorkflowSnapshot> {
  const threadId =
    input.threadId ??
    `wf_${input.userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const graph = await getWeeklyReportGraph();

  const initial = {
    threadId,
    userId: input.userId,
    userName: input.userName ?? "",
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    workflowRunId: input.workflowRunId ?? null,
    status: "collecting" as const,
    history: historyEvent("workflow_start", {
      workflowType: WEEKLY_REPORT_WORKFLOW_TYPE,
    }),
  };

  await syncRunStatus(input.workflowRunId, {
    status: "running",
    historyAppend: historyEvent("graph_invoke", { threadId }),
    metadata: { threadId },
  });

  const result = await graph.invoke(initial, threadConfig(threadId));
  // Fetch the fresh checkpointed state after invoke completes.
  // invoke updates the checkpointer, so getWorkflowStatus returns the latest values
  // (with reportId set by outputNode), not the pre-invoke checkpoint.
  const snap = await getWorkflowStatus(threadId, input.workflowRunId ?? null);
  return toSnapshot(threadId, result, snap, input.workflowRunId ?? null);
}

/**
 * Start workflow asynchronously — does NOT wait for HIL interrupt.
 *
 * Creates the DB record, fires graph.invoke() in the background,
 * and returns immediately after the first checkpoint (before HIL blocks).
 *
 * This is the path called by POST /api/ai/workflows so the button
 * doesn't stay stuck on "启动中..." while the graph waits for approval.
 */
export async function startWorkflowAsync(
  input: StartWorkflowInput
): Promise<{ runId: string; threadId: string }> {
  const threadId =
    input.threadId ??
    `wf_${input.userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const graph = await getWeeklyReportGraph();

  const initial = {
    threadId,
    userId: input.userId,
    userName: input.userName ?? "",
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    workflowRunId: input.workflowRunId ?? null,
    status: "collecting" as const,
    history: historyEvent("workflow_start", {
      workflowType: WEEKLY_REPORT_WORKFLOW_TYPE,
    }),
  };

  await syncRunStatus(input.workflowRunId, {
    status: "running",
    historyAppend: historyEvent("graph_invoke", { threadId }),
    metadata: { threadId },
  });

  // Fire and forget — let the graph run in the background.
  // On HIL interrupt the process sleeps inside LangGraph's checkpoint layer
  // until resume is called. This is fine; no CPU is wasted.
  graph.invoke(initial, threadConfig(threadId))
    .then(async (result) => {
      const snap = await getWorkflowStatus(threadId, input.workflowRunId ?? null);
      void toSnapshot(threadId, result, snap, input.workflowRunId ?? null);
    })
    .catch((err) => {
      // Unexpected error (not HIL): mark as failed.
      console.error("[workflow] background invoke error:", err);
      void syncRunStatus(input.workflowRunId, {
        status: "failed",
        historyAppend: historyEvent("workflow_error", {
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    });

  // Return immediately so the API can respond.
  return { runId: input.workflowRunId ?? "", threadId };
}

export async function resumeWorkflow(
  threadId: string,
  action: "message" | "approve" | "cancel",
  message?: string | null,
  workflowRunId?: string | null
): Promise<WorkflowSnapshot> {
  const graph = await getWeeklyReportGraph();
  const resumeValue: ReviewResumeValue = {
    action,
    message: message ?? undefined,
  };

  await syncRunStatus(workflowRunId, {
    status: action === "cancel" ? "cancelled" : "running",
    historyAppend: historyEvent("resume", { action, message }),
  });

  try {
    const result = await graph.invoke(
      new Command({ resume: resumeValue }),
      threadConfig(threadId)
    );
    const freshSnap = await getWorkflowStatus(threadId, workflowRunId);
    return toSnapshot(threadId, result, freshSnap, workflowRunId ?? null);
  } catch {
    // Checkpointer lost — fall back to DB
    const dbRun = workflowRunId
      ? await prisma.workflowRun.findUnique({
          where: { id: workflowRunId },
          select: { metadata: true, history: true },
        })
      : null;
    const meta =
      dbRun?.metadata && typeof dbRun.metadata === "object"
        ? (dbRun.metadata as Record<string, unknown>)
        : null;
    const hist = Array.isArray(dbRun?.history)
      ? (dbRun.history as unknown as WorkflowHistoryEntry[])
      : [];

    return {
      threadId,
      status: action === "cancel" ? "cancelled" : "done",
      interrupted: false,
      interruptPayload: null,
      values: hist.length > 0 ? { history: hist } : null,
      reportId: (meta?.reportId as string) ?? null,
      error: null,
      workflowRunId: workflowRunId ?? null,
    };
  }
}

export async function getWorkflowStatus(
  threadId: string,
  workflowRunId?: string | null
): Promise<WorkflowSnapshot> {
  const graph = await getWeeklyReportGraph();

  // Fallback snapshot from DB record — used when checkpointer has no state
  const dbRun = workflowRunId
    ? await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
        select: {
          status: true,
          metadata: true,
          history: true,
        },
      })
    : null;

  let state;
  try {
    state = await graph.getState(threadConfig(threadId));
  } catch {
    // Checkpointer lost (MemorySaver cleared on server restart) —
    // fall back to DB record which always has the authoritative status
    const dbStatus = dbRun?.status ?? "running";
    const dbMeta =
      dbRun?.metadata && typeof dbRun.metadata === "object"
        ? (dbRun.metadata as Record<string, unknown>)
        : null;
    const dbHistory = Array.isArray(dbRun?.history)
      ? (dbRun.history as unknown as WorkflowHistoryEntry[])
      : [];

    return {
      threadId,
      status: dbStatus,
      interrupted: false,
      interruptPayload: null,
      values: dbHistory.length > 0 ? { history: dbHistory } : null,
      reportId: (dbMeta?.reportId as string) ?? null,
      error: null,
      workflowRunId: workflowRunId ?? null,
    };
  }

  const values = (state.values ?? null) as Partial<WorkflowState> | null;

  const tasks = state.tasks ?? [];
  let interruptPayload: unknown | null = null;
  for (const task of tasks) {
    const interrupts = (task as { interrupts?: Array<{ value?: unknown }> })
      .interrupts;
    if (interrupts && interrupts.length > 0) {
      interruptPayload = interrupts[0]?.value ?? interrupts[0];
      break;
    }
  }

  const interrupted =
    Boolean(interruptPayload) ||
    (Array.isArray(state.next) &&
      state.next.includes("waitReview") &&
      values?.status === "waiting_review");

  const status =
    values?.status ??
    (interrupted ? "waiting_review" : state.next?.length ? "running" : "done");

  return {
    threadId,
    status,
    interrupted,
    interruptPayload,
    values,
    reportId: values?.reportId ?? null,
    error: values?.error ?? null,
    workflowRunId: workflowRunId ?? values?.workflowRunId ?? null,
  };
}

async function toSnapshot(
  threadId: string,
  result: unknown,
  freshSnap: WorkflowSnapshot,
  workflowRunId: string | null
): Promise<WorkflowSnapshot> {
  const interruptPayload = extractInterruptPayload(result);

  // If interrupted: use the checkpoint values from freshSnap
  // If not interrupted: use invoke result values (which may be stale checkpointer state)
  if (interruptPayload) {
    const snap = freshSnap;
    await syncRunStatus(workflowRunId ?? snap.workflowRunId, {
      status: "waiting_review",
      historyAppend: historyEvent("interrupted", {
        payload: interruptPayload ?? snap.interruptPayload,
      }),
    });
    return {
      ...snap,
      interrupted: true,
      interruptPayload: interruptPayload ?? snap.interruptPayload,
    };
  }

  // Not interrupted: use the invoke result values if available,
  // otherwise fall back to freshSnap values
  const values =
    result && typeof result === "object" && !isInterrupted(result)
      ? (result as Partial<WorkflowState>)
      : null;

  const status = values?.status ?? (freshSnap.status === "done" ? "done" : freshSnap.status);

  if (status === "done" || status === "cancelled") {
    await syncRunStatus(workflowRunId ?? values?.workflowRunId, {
      status,
      metadata: values?.reportId ? { reportId: values.reportId } : undefined,
      historyAppend: historyEvent("workflow_finish", { status }),
    });
  }

  return {
    threadId,
    status,
    interrupted: false,
    interruptPayload,
    values: values ?? freshSnap.values,
    reportId: values?.reportId ?? freshSnap.reportId,
    error: values?.error ?? null,
    workflowRunId: workflowRunId ?? values?.workflowRunId ?? null,
  };
}
