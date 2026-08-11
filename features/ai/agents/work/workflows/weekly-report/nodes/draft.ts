/**
 * Weekly Report Workflow — Draft Node
 */

import type { WorkflowState, WorkflowStateUpdate } from "../state";
import { historyEvent } from "../state";
import { draftWeeklyReport } from "../tools/weekly-report-tools";

export async function draftNode(
  state: WorkflowState
): Promise<WorkflowStateUpdate> {
  if (!state.collectedData) {
    return {
      status: "cancelled",
      error: "No collected data for draft",
      history: historyEvent("draft_error", { message: "missing collectedData" }),
    };
  }

  try {
    const draft = await draftWeeklyReport(
      state.userId,
      new Date(state.weekStart),
      new Date(state.weekEnd),
      state.collectedData
    );

    if (draft._error) {
      return {
        draft,
        status: "waiting_review",
        error: draft._error,
        history: historyEvent("draft_partial", { error: draft._error }),
      };
    }

    return {
      draft,
      status: "waiting_review",
      error: null,
      history: historyEvent("draft_ready", {
        highlights: draft.highlights.length,
        tasks: draft.tasks.length,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "draft failed";
    return {
      status: "cancelled",
      error: message,
      history: historyEvent("draft_error", { message }),
    };
  }
}
