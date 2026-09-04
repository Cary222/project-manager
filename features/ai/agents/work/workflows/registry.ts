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
export const projectProgressWorkflow: WorkflowDefinition = {
  type: "project_progress",
  name: "项目进展汇总",
  description: "汇总项目活跃工单、最新 Git 提交并生成核心指标与进展报告",
  nodes: [
    { id: "collect", type: "collect", label: "采集工单与提交", description: "统计项目当前活跃工单与 Git 提交" },
    { id: "synthesize", type: "output", label: "AI 总结与指标", description: "生成 4 项核心指标与项目进展摘要" },
  ],
  edges: [
    { from: "__start__", to: "collect" },
    { from: "collect", to: "synthesize" },
    { from: "synthesize", to: "__end__" },
  ],
  initialState: { status: "collecting" },
};

export const meetingMinutesWorkflow: WorkflowDefinition = {
  type: "meeting_minutes",
  name: "会议纪要整理",
  description: "对会议录音或文本进行 Whisper 转写与 7 要素提炼，一键发布到项目知识库",
  nodes: [
    { id: "transcribe", type: "collect", label: "录音转写", description: "Whisper 语音转写" },
    { id: "summarize", type: "draft", label: "7要素提炼", description: "提炼核心议题与行动项" },
    { id: "publish", type: "output", label: "发布知识库", description: "写入知识库并进行向量索引" },
  ],
  edges: [
    { from: "__start__", to: "transcribe" },
    { from: "transcribe", to: "summarize" },
    { from: "summarize", to: "publish" },
    { from: "publish", to: "__end__" },
  ],
  initialState: { status: "ready" },
};

export const codingWorkflow: WorkflowDefinition = {
  type: "coding",
  name: "Coding 任务开发",
  description: "通过 Pi Coding Agent 独立执行代码变更、测试验证与 Diff 审查",
  nodes: [
    { id: "dispatch", type: "collect", label: "分配 Session", description: "创建 Pi Coding 会话" },
    { id: "execute", type: "draft", label: "执行代码变更", description: "代码编写与执行" },
    { id: "verify", type: "output", label: "测试验证", description: "运行测试并输出 Diff" },
  ],
  edges: [
    { from: "__start__", to: "dispatch" },
    { from: "dispatch", to: "execute" },
    { from: "execute", to: "verify" },
    { from: "verify", to: "__end__" },
  ],
  initialState: { status: "pending" },
};

// Register built-in workflows
registerWorkflow(weeklyReportWorkflow);
registerWorkflow(projectProgressWorkflow);
registerWorkflow(meetingMinutesWorkflow);
registerWorkflow(codingWorkflow);
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
