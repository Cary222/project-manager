/**
 * Work Agent — Route Types
 *
 * 原 RouteExecutor 类已删除（职责由 graph.ts 的 dispatchNode + executeWorkflowNode 承担）。
 * 保留 ExecutionContext 接口供 planner/dynamic-executor.ts 使用。
 */

// ─── Execution Context ────────────────────────────────────────────────────────

export interface ExecutionContext {
  runId: string;
  userId: string;
  threadId?: string;
  checkpointNamespace?: string;
}
