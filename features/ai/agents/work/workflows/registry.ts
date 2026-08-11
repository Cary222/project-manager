/**
 * Workflow Registry — 工作流注册表
 *
 * 统一管理所有工作流定义。
 */

import type { WorkflowDefinition } from "@/features/ai/runtime/types";

// WorkflowTemplate is an alias for WorkflowDefinition (used in router/)
export type WorkflowTemplate = WorkflowDefinition;

// Re-export workflow types and functions
export {
  WEEKLY_REPORT_WORKFLOW_TYPE,
  getWeeklyReportGraph,
  type WeeklyReportCompiledGraph,
} from "./weekly-report/graph";

export { WorkflowStateAnnotation, type WorkflowState } from "./weekly-report/state";

// ============================================================================
// Workflow Registry
// ============================================================================

const workflows = new Map<string, WorkflowDefinition>();

/**
 * Register a workflow type.
 */
export function registerWorkflow(workflow: WorkflowDefinition): void {
  workflows.set(workflow.type, workflow);
}

/**
 * Get a workflow by type.
 */
export function getWorkflow(type: string): WorkflowDefinition | undefined {
  return workflows.get(type);
}

/**
 * List all registered workflows.
 */
export function listWorkflows(): WorkflowDefinition[] {
  return Array.from(workflows.values());
}

// ============================================================================
// Built-in Workflows
// ============================================================================

/**
 * Weekly Report workflow definition.
 */
export const weeklyReportWorkflow: WorkflowDefinition = {
  type: "weekly_report",
  name: "周报生成",
  description: "自动汇总本周工单、提交和进度，生成结构化周报",
  nodes: [
    { id: "collectData", type: "collect", label: "采集数据", description: "拉取工单和提交数据" },
    { id: "draft", type: "draft", label: "生成草稿", description: "基于数据生成周报草稿" },
    { id: "waitReview", type: "approve", label: "等待审批", description: "等待用户确认或修改", requiresApproval: true },
    { id: "revise", type: "revise", label: "修订草稿", description: "根据反馈修订" },
    { id: "output", type: "output", label: "输出周报", description: "写入周报数据库" },
  ],
  edges: [
    { from: "__start__", to: "collectData" },
    { from: "collectData", to: "draft" },
    { from: "draft", to: "waitReview" },
    { from: "waitReview", to: "output", condition: (s) => (s as { reviewDecision?: string }).reviewDecision === "approve" },
    { from: "waitReview", to: "revise", condition: (s) => (s as { reviewDecision?: string }).reviewDecision === "revise" },
    { from: "revise", to: "waitReview" },
    { from: "output", to: "__end__" },
  ],
  initialState: {
    status: "collecting",
  },
};

// Register built-in workflows
registerWorkflow(weeklyReportWorkflow);

// ============================================================================
// Workflow Graph Adapter
// ============================================================================

export interface WorkflowGraphAdapter {
  type: string;
  getGraph(): Promise<unknown>;
}

/**
 * Adapter for weekly report workflow.
 */
export const weeklyReportAdapter: WorkflowGraphAdapter = {
  type: "weekly_report",
  async getGraph() {
    const { getWeeklyReportGraph } = await import("./weekly-report/graph");
    return getWeeklyReportGraph();
  },
};

/**
 * Get graph adapter for workflow type.
 */
export async function getWorkflowGraph(type: string): Promise<unknown> {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`Unknown workflow type: ${type}`);
  }
  return adapter.getGraph();
}

// ============================================================================
// Adapter Registry
// ============================================================================

const adapters = new Map<string, WorkflowGraphAdapter>();

export function registerWorkflowAdapter(adapter: WorkflowGraphAdapter): void {
  adapters.set(adapter.type, adapter);
}

registerWorkflowAdapter(weeklyReportAdapter);
