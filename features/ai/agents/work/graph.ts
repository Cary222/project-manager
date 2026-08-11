/**
 * Work Agent — 主 Graph
 *
 * 这是 Work Agent 的入口点，协调 runtime、workflows 和 tools。
 *
 * 架构：
 * 1. Runtime: planner / approval / lifecycle / scheduler
 * 2. Workflows: weekly-report 等任务模板
 * 3. Tools: 受限的文件和命令工具
 *
 * 使用 LangGraph 的 Command 和 interrupt 实现 HIL。
 */

import { Annotation, Command, START } from "@langchain/langgraph";
import { registerWorkTools } from "./tools";

// ============================================================================
// State Annotation
// ============================================================================

const lastValue = <T>(defaultFn: () => T) =>
  Annotation<T>({
    value: (current, update) => (update === undefined ? current : update),
    default: defaultFn,
  });

const WorkAgentAnnotation = Annotation.Root({
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
  status: lastValue(() => "pending"),

  // HIL
  pendingApproval: lastValue<ApprovalRequest | null>(() => null),
  waitingForHuman: lastValue(() => false),

  // Result
  artifacts: lastValue<Record<string, unknown>>(() => ({})),
  summary: lastValue<string | null>(() => null),
  error: lastValue<string | null>(() => null),

  // Meta
  startedAt: lastValue(() => 0),
  updatedAt: lastValue(() => 0),
});

type WorkAgentState = typeof WorkAgentAnnotation.State;

interface WorkStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
}

interface ApprovalRequest {
  title: string;
  description: string;
  candidates?: { id: string; label: string }[];
}

// ============================================================================
// Agent Entry Point
// ============================================================================

/**
 * Initialize the Work Agent.
 * Must be called before first use.
 */
export function initializeWorkAgent(): void {
  registerWorkTools();
}

// ============================================================================
// Nodes (Placeholder)
// ============================================================================

/**
 * Plan node: break down goal into steps.
 */
async function planNode(state: WorkAgentState): Promise<Partial<WorkAgentState>> {
  return {
    status: "planning",
    updatedAt: Date.now(),
  };
}

/**
 * Execute node: run current step.
 */
async function executeNode(state: WorkAgentState): Promise<Partial<WorkAgentState>> {
  return {
    status: "executing",
    updatedAt: Date.now(),
  };
}

/**
 * Approval node: request human approval.
 */
async function approvalNode(state: WorkAgentState): Promise<Partial<WorkAgentState>> {
  // This will be replaced with actual interrupt() call
  return {
    status: "waiting_approval",
    waitingForHuman: true,
    pendingApproval: {
      title: "待审批",
      description: "请审阅并决定是否继续",
    },
    updatedAt: Date.now(),
  };
}

/**
 * Finish node: complete the workflow.
 */
async function finishNode(state: WorkAgentState): Promise<Partial<WorkAgentState>> {
  return {
    status: "completed",
    waitingForHuman: false,
    summary: "任务已完成",
    updatedAt: Date.now(),
  };
}

/**
 * Fail node: handle errors.
 */
async function failNode(state: WorkAgentState): Promise<Partial<WorkAgentState>> {
  return {
    status: "failed",
    waitingForHuman: false,
    error: state.error ?? "未知错误",
    updatedAt: Date.now(),
  };
}

// ============================================================================
// Edges
// ============================================================================

function shouldApprove(state: WorkAgentState): string {
  if (state.steps.length === 0) return "plan";
  const lastStep = state.steps[state.steps.length - 1];
  if (lastStep.status === "done" && state.waitingForHuman) return "approval";
  if (state.waitingForHuman) return "approval";
  if (state.error) return "fail";
  if (state.status === "completed") return "finish";
  return "execute";
}

// ============================================================================
// Export
// ============================================================================

export { WorkAgentAnnotation, type WorkAgentState };
