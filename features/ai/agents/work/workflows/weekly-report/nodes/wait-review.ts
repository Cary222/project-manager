/**
 * Weekly Report Workflow — Wait Review Node
 */

import { interrupt } from "@langchain/langgraph";
import { getWeekReportTitle } from "@/features/weekly-reports/lib/week";
import type { WorkflowState, WorkflowStateUpdate, ReviewDecision } from "../state";
import { historyEvent } from "../state";

export interface ReviewInterruptPayload {
  conversationMode: true;
  revisionCount: number;
  draft: WorkflowState["draft"];
  weekStart: string;
  weekEnd: string;
}

export interface ReviewResumeValue {
  // conversationMode: 用户发消息继续对话
  // approve: 直接确认生成（前端收到预填数据，跳转编辑页）
  // cancel: 取消
  action: "message" | "approve" | "cancel";
  message?: string;
}

/**
 * Pauses the graph for conversational review.
 * Supports multi-turn dialogue before final approval.
 * Do NOT wrap interrupt() in try/catch that swallows GraphInterrupt.
 */
export function waitReviewNode(
  state: WorkflowState
): WorkflowStateUpdate {
  // Count how many times we've gone through revise → waitReview
  const revisionCount = state.history.reduce((acc, h) => {
    if (h.event === "review_revise") return acc + 1;
    return acc;
  }, 0);

  const resume = interrupt<ReviewInterruptPayload, ReviewResumeValue>({
    conversationMode: true,
    revisionCount,
    draft: state.draft,
    weekStart: state.weekStart,
    weekEnd: state.weekEnd,
  });

  const action = resume?.action ?? null;

  if (action === "cancel") {
    return {
      reviewDecision: "cancel",
      reviewFeedback: resume?.message ?? null,
      status: "cancelled",
      history: historyEvent("review_cancel", { message: resume?.message }),
    };
  }

  if (action === "message") {
    return {
      reviewDecision: "revise",
      reviewFeedback: resume?.message ?? null,
      status: "revising",
      history: historyEvent("review_revise", {
        revisionCount: revisionCount + 1,
        message: resume?.message,
      }),
    };
  }

  // action === "approve" — compute pre-fill data for the editor.
  // Status stays "waiting_review"; frontend reads prefill from snapshot,
  // renders it in DraftPreview, and user clicks "一键生成" to POST.
  const title = getWeekReportTitle(new Date(state.weekStart));
  const content =
    state.draft?.rawMarkdown?.trim() ||
    [
      "## 本周重点",
      ...((state.draft?.highlights ?? []).map((h) => `- ${h}`)),
      "",
      "## 完成任务",
      ...((state.draft?.tasks ?? []).map((t) => `- ${t}`)),
      "",
      "## 下周计划",
      ...((state.draft?.nextPlan ?? []).map((p) => `- ${p}`)),
    ].join("\n");

  return {
    reviewDecision: "approve",
    reviewFeedback: resume?.message ?? null,
    status: "waiting_review", // stay in review — prefill is shown in DraftPreview
    prefillTitle: title,
    prefillContent: content,
    prefillWeekStart: state.weekStart,
    prefillWeekEnd: state.weekEnd,
    prefillProjectIds: state.draft?.projectIds ?? [],
    history: historyEvent("review_approve", {}),
  };
}
