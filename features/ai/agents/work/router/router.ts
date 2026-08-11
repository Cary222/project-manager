/**
 * Work Agent — Router
 *
 * 职责：
 * - 判断用户 goal 是否有匹配的模板
 * - 有模板 → 返回 workflow 路径
 * - 无模板 → 返回 planner 路径（autonomous fallback）
 */

export type ExecutionStrategy =
  | { mode: "workflow"; workflowId: string; params?: Record<string, unknown> }
  | { mode: "planning"; goal: string; context?: Record<string, unknown> };

export interface RouterResult {
  strategy: ExecutionStrategy;
  confidence: number;
  reason?: string;
}

export interface RouterContext {
  userId: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  attachments?: Array<{ type: string; url: string }>;
}

// ─── Router Interface ─────────────────────────────────────────────────────────

export interface Router {
  /**
   * 根据用户输入决定执行策略。
   */
  route(input: string, context?: RouterContext): Promise<RouterResult>;
}

// ─── Router Result Helpers ───────────────────────────────────────────────────

export function isWorkflowStrategy(result: RouterResult): boolean {
  return result.strategy.mode === "workflow";
}

export function isPlanningStrategy(result: RouterResult): boolean {
  return result.strategy.mode === "planning";
}
