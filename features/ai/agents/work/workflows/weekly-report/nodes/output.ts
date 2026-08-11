/**
 * Weekly Report Workflow — Output Node
 */

import { prisma } from "@/shared/db/client";
import { getWeekReportTitle } from "@/features/weekly-reports/lib/week";
import type { WorkflowState, WorkflowStateUpdate } from "../state";
import { historyEvent } from "../state";

/**
 * Upsert WeeklyReport with idempotency:
 * - If a report is already linked to this workflowRunId → reuse
 * - Else if (userId, weekStart) unique exists → update content + link run
 * - Else create
 *
 * Prevents duplicate writes when multiple approvers resume concurrently.
 */
export async function outputNode(
  state: WorkflowState
): Promise<WorkflowStateUpdate> {
  if (!state.draft) {
    return {
      status: "cancelled",
      error: "No draft to output",
      history: historyEvent("output_error", { message: "missing draft" }),
    };
  }

  try {
    const weekStart = new Date(state.weekStart);
    const weekEnd = new Date(state.weekEnd);
    const title = getWeekReportTitle(weekStart);
    const content =
      state.draft.rawMarkdown?.trim() ||
      [
        "## 本周重点",
        ...(state.draft.highlights.map((h) => `- ${h}`) || []),
        "",
        "## 完成任务",
        ...(state.draft.tasks.map((t) => `- ${t}`) || []),
        "",
        "## 下周计划",
        ...(state.draft.nextPlan.map((p) => `- ${p}`) || []),
      ].join("\n");

    // 1) Idempotent by workflowRunId
    if (state.workflowRunId) {
      const byRun = await prisma.weeklyReport.findFirst({
        where: { workflowRunId: state.workflowRunId },
        select: { id: true },
      });
      if (byRun) {
        return {
          reportId: byRun.id,
          status: "done",
          error: null,
          history: historyEvent("output_idempotent_run", { reportId: byRun.id }),
        };
      }
    }

    // 2) Upsert by (userId, weekStart) unique
    const existing = await prisma.weeklyReport.findUnique({
      where: {
        userId_weekStart: {
          userId: state.userId,
          weekStart,
        },
      },
      select: { id: true },
    });

    let reportId: string;

    if (existing) {
      const updated = await prisma.weeklyReport.update({
        where: { id: existing.id },
        data: {
          title,
          content,
          weekEnd,
          workflowRunId: state.workflowRunId ?? undefined,
        },
        select: { id: true },
      });
      reportId = updated.id;
    } else {
      try {
        const created = await prisma.weeklyReport.create({
          data: {
            userId: state.userId,
            weekStart,
            weekEnd,
            title,
            content,
            workflowRunId: state.workflowRunId,
          },
          select: { id: true },
        });
        reportId = created.id;
      } catch (err) {
        // Concurrent create race on unique(userId, weekStart) — fall back to update
        const raced = await prisma.weeklyReport.findUnique({
          where: {
            userId_weekStart: {
              userId: state.userId,
              weekStart,
            },
          },
          select: { id: true },
        });
        if (!raced) throw err;
        const updated = await prisma.weeklyReport.update({
          where: { id: raced.id },
          data: {
            title,
            content,
            weekEnd,
            workflowRunId: state.workflowRunId ?? undefined,
          },
          select: { id: true },
        });
        reportId = updated.id;
      }
    }

    if (state.workflowRunId) {
      await prisma.workflowRun.update({
        where: { id: state.workflowRunId },
        data: {
          status: "done",
          metadata: {
            reportId,
          } as object,
        },
      }).catch(() => {
        /* run row may not exist yet in early smoke — ignore */
      });
    }

    return {
      reportId,
      status: "done",
      error: null,
      history: historyEvent("output_done", { reportId }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "output failed";
    return {
      status: "cancelled",
      error: message,
      history: historyEvent("output_error", { message }),
    };
  }
}
