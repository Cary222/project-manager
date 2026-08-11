/**
 * Weekly Report Workflow — Routing Edges
 */

import type { WorkflowState } from "../state";

/** After waitReview: approve→output→END, revise→revise, cancel→END */
export function routeAfterWaitReview(
  state: WorkflowState
): "revise" | "output" | "__end__" {
  if (state.status === "cancelled" || state.reviewDecision === "cancel") {
    return "__end__";
  }
  if (state.reviewDecision === "revise" || state.status === "revising") {
    return "revise";
  }
  // approve: outputNode writes the weekly report to DB and sets reportId
  return "output";
}

/** After revise always go back to waitReview (unless cancelled/error terminal). */
export function routeAfterRevise(
  state: WorkflowState
): "waitReview" | "__end__" {
  if (state.status === "cancelled") {
    return "__end__";
  }
  return "waitReview";
}

/** Early exit if collect/draft already cancelled. */
export function routeAfterDraft(
  state: WorkflowState
): "waitReview" | "__end__" {
  if (state.status === "cancelled") {
    return "__end__";
  }
  return "waitReview";
}

export function routeAfterCollect(
  state: WorkflowState
): "draftReport" | "__end__" {
  if (state.status === "cancelled") {
    return "__end__";
  }
  return "draftReport";
}
