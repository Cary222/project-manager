/**
 * Weekly Report Workflow — State
 *
 * 业务状态定义，包含周报特有的字段。
 */

import { Annotation } from "@langchain/langgraph";
import type { WeeklyContext } from "@/features/reports/weekly-reports/lib/context-aggregator";
import type { WeeklyDraftSummary } from "@/features/reports/weekly-reports/lib/draft-summary";

export type ReviewDecision = "approve" | "revise" | "cancel";

export type WorkflowStatus =
  | "collecting"
  | "drafting"
  | "waiting_review"
  | "revising"
  | "outputting"
  | "done"
  | "cancelled";

export interface WorkflowHistoryEntry {
  timestamp: string;
  event: string;
  payload?: unknown;
}

export type WorkflowDraft = WeeklyDraftSummary | null;

const lastValue = <T>(defaultFn: () => T) =>
  Annotation<T>({
    value: (current, update) => (update === undefined ? current : update),
    default: defaultFn,
  });

export const WorkflowStateAnnotation = Annotation.Root({
  threadId: lastValue<string>(() => ""),
  userId: lastValue<string>(() => ""),
  userName: lastValue<string>(() => ""),
  weekStart: lastValue<string>(() => ""),
  weekEnd: lastValue<string>(() => ""),
  collectedData: lastValue<WeeklyContext | null>(() => null),
  draft: lastValue<WorkflowDraft>(() => null),
  reviewDecision: lastValue<ReviewDecision | null>(() => null),
  reviewFeedback: lastValue<string | null>(() => null),
  reportId: lastValue<string | null>(() => null),
  workflowRunId: lastValue<string | null>(() => null),
  status: lastValue<WorkflowStatus>(() => "collecting"),
  error: lastValue<string | null>(() => null),
  // prefill data returned after approve — consumed by DraftPreview
  prefillTitle: lastValue<string>(() => ""),
  prefillContent: lastValue<string>(() => ""),
  prefillWeekStart: lastValue<string>(() => ""),
  prefillWeekEnd: lastValue<string>(() => ""),
  prefillProjectIds: lastValue<string[]>(() => []),
  history: Annotation<WorkflowHistoryEntry[]>({
    value: (current, update) => {
      if (!update) return current ?? [];
      return [...(current ?? []), ...update];
    },
    default: () => [],
  }),
});

export type WorkflowState = typeof WorkflowStateAnnotation.State;
export type WorkflowStateUpdate = typeof WorkflowStateAnnotation.Update;

export function historyEvent(
  event: string,
  payload?: unknown
): WorkflowHistoryEntry[] {
  return [
    {
      timestamp: new Date().toISOString(),
      event,
      payload,
    },
  ];
}
