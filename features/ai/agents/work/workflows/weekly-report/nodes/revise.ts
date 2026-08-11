/**
 * Weekly Report Workflow — Revise Node
 *
 * Receives conversational feedback from user, asks AI to revise the draft.
 * After revise → waitReview again (multi-turn conversation loop).
 */

import type { WorkflowState, WorkflowStateUpdate } from "../state";
import { historyEvent } from "../state";
import { reviseWeeklyDraft } from "../tools/weekly-report-tools";

export async function reviseNode(
  state: WorkflowState
): Promise<WorkflowStateUpdate> {
  if (!state.draft) {
    return {
      status: "cancelled",
      error: "No draft to revise",
      history: historyEvent("revise_error", { message: "missing draft" }),
    };
  }

  if (!state.collectedData) {
    return {
      status: "cancelled",
      error: "No collected data to revise from",
      history: historyEvent("revise_error", { message: "missing collectedData" }),
    };
  }

  const feedback = state.reviewFeedback?.trim();
  if (!feedback) {
    // No message — skip revise and go back to review
    return {
      status: "waiting_review",
      reviewDecision: null,
      history: historyEvent("revise_skip", { reason: "empty feedback" }),
    };
  }

  try {
    const draft = await reviseWeeklyDraft(
      state.userId,
      state.draft,
      feedback,
      state.collectedData
    );
    return {
      draft,
      reviewDecision: null,
      reviewFeedback: null,
      status: "waiting_review", // Always loop back for another round
      error: draft._error ?? null,
      history: historyEvent("revise_done", {
        error: draft._error ?? null,
        feedbackPreview: feedback.slice(0, 100),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "revise failed";
    return {
      status: "waiting_review", // Stay in review loop even on error
      reviewDecision: null,
      error: message,
      history: historyEvent("revise_error", { message }),
    };
  }
}
