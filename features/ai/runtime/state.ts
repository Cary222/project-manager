/**
 * Runtime State — Work Agent 的 LangGraph 状态定义
 *
 * 基于 Plan B-1 约束：
 * - 状态必须与 AgentRun.status 一致
 * - 通过 lifecycle 封装更新，不允许业务节点直接修改
 */

import { Annotation } from "@langchain/langgraph";

// ============================================================================
// State Annotation
// ============================================================================

const lastValue = <T>(defaultFn: () => T) =>
  Annotation<T>({
    value: (current, update) => (update === undefined ? current : update),
    default: defaultFn,
  });

export const WorkAgentStateAnnotation = Annotation.Root({
  // Identity
  runId: lastValue(() => ""),
  userId: lastValue(() => ""),
  userName: lastValue(() => ""),
  sessionId: lastValue(() => ""),

  // Workflow
  workflowType: lastValue(() => ""),
  workflowName: lastValue(() => ""),

  // Execution
  steps: lastValue<WorkStep[]>(() => []),
  currentStepIndex: lastValue(() => 0),
  status: lastValue<WorkAgentStatus>(() => "pending"),

  // HIL (Human-in-the-Loop)
  pendingApproval: lastValue<PendingApproval | null>(() => null),
  waitingForHuman: lastValue(() => false),

  // Result
  artifacts: lastValue<Record<string, unknown>>(() => ({})),
  summary: lastValue<string | null>(() => null),
  error: lastValue<string | null>(() => null),

  // Meta
  startedAt: lastValue(() => 0),
  updatedAt: lastValue(() => 0),
});

// ============================================================================
// State Types
// ============================================================================

export type WorkAgentStatus =
  | "pending"
  | "planning"
  | "executing"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkStep {
  id: string;
  label: string;
  description: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  result?: unknown;
  startedAt?: number;
  completedAt?: number;
}

export interface PendingApproval {
  type: "approve" | "revise" | "reject";
  title: string;
  description: string;
  candidates?: ApprovalCandidate[];
  context: Record<string, unknown>;
}

export interface ApprovalCandidate {
  id: string;
  label: string;
  summary: string;
}

// ============================================================================
// State Helpers
// ============================================================================

export type WorkAgentState = typeof WorkAgentStateAnnotation.State;

/**
 * Create initial state for a new work run.
 */
export function createInitialState(params: {
  runId: string;
  userId: string;
  userName: string;
  sessionId: string;
  workflowType: string;
  workflowName: string;
}): WorkAgentState {
  return {
    runId: params.runId,
    userId: params.userId,
    userName: params.userName,
    sessionId: params.sessionId,
    workflowType: params.workflowType,
    workflowName: params.workflowName,
    steps: [],
    currentStepIndex: 0,
    status: "pending",
    pendingApproval: null,
    waitingForHuman: false,
    artifacts: {},
    summary: null,
    error: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Update step status helper.
 */
export function updateStepStatus(
  state: WorkAgentState,
  stepId: string,
  status: WorkStep["status"],
  result?: unknown,
): WorkAgentState {
  const steps = state.steps.map((s) => {
    if (s.id === stepId) {
      return {
        ...s,
        status,
        result,
        startedAt: status === "running" ? Date.now() : s.startedAt,
        completedAt: status === "done" || status === "failed" ? Date.now() : s.completedAt,
      };
    }
    return s;
  });

  return {
    ...state,
    steps,
    updatedAt: Date.now(),
  };
}

/**
 * Map lifecycle event type to status.
 */
export function lifecycleEventToStatus(event: {
  type: "started" | "completed" | "failed" | "cancelled";
}): WorkAgentStatus {
  switch (event.type) {
    case "started":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}
