/**
 * Runtime Types — Work Agent 的通用运行时类型
 *
 * 原则：
 * - Runtime 只定义通用能力接口，不包含任何业务字段
 * - Workflow 业务字段（如 weekStart, draft）属于 workflow 层
 * - Tool 相关类型属于 runtime，因为所有 agent 都需要工具能力
 */

// ============================================================================
// Agent Run Status — AgentRun 表状态（业务无关的通用状态）
// ============================================================================

export type AgentRunStatus =
  | "pending"      // 排队中
  | "running"     // 运行中
  | "waiting"     // 等待用户输入
  | "completed"   // 已完成
  | "failed"      // 执行失败
  | "cancelled"   // 用户取消
  | "expired";    // 业务过期（如周报审批超时）

// ============================================================================
// Planner Types — 计划拆解（通用，计划本身的结构，不是 workflow）
// ============================================================================

/**
 * 目标 — 由 router/planner 生成，不包含业务参数。
 * 业务参数由具体的 planner 或 workflow 自行管理。
 */
export interface Goal {
  id: string;
  type: string;       // 如 "weekly_report", "custom"
  description: string;
  createdAt: string;
}

/**
 * 计划步骤 — 通用步骤结构，不包含具体业务字段。
 */
export interface PlanStep {
  id: string;
  label: string;
  description: string;
  tool?: string;       // 工具名称
  dependsOn: string[]; // 依赖的步骤 ID
}

/**
 * 计划 — 由 planner 生成。
 */
export interface Plan {
  goal: Goal;
  steps: PlanStep[];
  estimatedSteps: number;
  requiresApproval: boolean;
}

// ============================================================================
// Checkpointer Types — 状态持久化
// ============================================================================

export interface CheckpointMetadata {
  runId: string;
  threadId: string;
  checkpointId: string;
  createdAt: number;
  status: AgentRunStatus;
}

export type CheckpointerFactory = (config: CheckpointerConfig) => Checkpointer;

export interface CheckpointerConfig {
  type: "memory" | "postgres";
  threadId: string;
}

export interface Checkpointer {
  get(): Promise<unknown | null>;
  put(state: unknown): Promise<CheckpointMetadata>;
  delete(): Promise<void>;
}

// ============================================================================
// Workflow Definition — 工作流元信息（用于 registry 和 workflow match）
// ============================================================================

export interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  description: string;
  requiresApproval?: boolean;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: (state: unknown) => boolean;
}

export interface WorkflowDefinition {
  type: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  initialState?: Record<string, unknown>;
}
