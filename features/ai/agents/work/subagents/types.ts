/**
 * SubAgent 抽象层类型定义
 *
 * 以 SubAgentRun 为核心实体，定义 SubAgent 生命周期和事件类型。
 *
 * Phase 2: 基础抽象 + Pi 实现
 * Phase 3: Policy Gateway 接入
 */

// ============================================================================
// Run 实体（Runtime 概念，不一定立刻进 DB）
// ============================================================================

export type SubAgentStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubAgentRun {
  runId: string;
  agentType: "pi" | "claude-code" | string;
  workspaceId: string;
  sessionId: string;
  status: SubAgentStatus;
  parentRunId?: string;
  lastEventId?: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  lastInput?: string;
}

// ============================================================================
// BaseSubAgent 接口
// ============================================================================

export interface SubAgentInput {
  prompt: string;
  workspace: string;
  contextFiles?: string[];
  policy?: PolicyConfig;
  /** 用户 ID（用于获取用户 API key 配置） */
  userId?: string;
  /** LLM Provider（显式指定时优先使用） */
  provider?: string;
  /** 显式指定模型 */
  model?: {
    provider: string;
    name: string;
  };
}

export interface PolicyConfig {
  allowList?: string[];
  denyList?: string[];
  maxDurationMs?: number;
}

export interface SubAgentHandle {
  runId: string;
  sessionId: string;
  events: AsyncIterable<SubAgentEvent>;
  awaitCompletion(): Promise<SubAgentResult>;
  cancel(): Promise<void>;
}

export interface SubAgentResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  artifacts: Record<string, unknown>;
  summary?: string;
  error?: string;
  durationMs: number;
}

export interface BaseSubAgent {
  readonly type: string;
  readonly displayName: string;

  /** 启动一个 run，返回 handle */
  start(run: SubAgentRun, input: SubAgentInput): Promise<SubAgentHandle>;

  /** 中断运行 */
  cancel(runId: string): Promise<void>;

  /** 恢复被暂停的 run */
  resume(runId: string, userInput: string): Promise<SubAgentHandle>;

  /** 获取 run 状态 */
  getRun(runId: string): SubAgentRun | undefined;
}

// ============================================================================
// 事件流（与 Pi 原生事件解耦）
// ============================================================================

export type SubAgentEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "assistant_message"; runId: string; content: string; delta?: string }
  | { type: "tool_call"; runId: string; eventId: string; tool: string; args: Record<string, unknown>; callId: string }
  | { type: "tool_result"; runId: string; callId: string; result: unknown; success: boolean }
  | { type: "tool_error"; runId: string; callId: string; error: string }
  | { type: "approval_required"; runId: string; callId: string; tool: string; args: unknown; reason: string }
  | { type: "progress"; runId: string; message: string; percent?: number }
  | { type: "error"; runId: string; message: string }
  | { type: "run_completed"; runId: string; result: SubAgentResult };

// ============================================================================
// Policy Gateway 类型（Phase 3 接入）
// ============================================================================

export type PolicyDecision = "allow" | "approve" | "deny";

export interface PolicyContext {
  runId: string;
  tool: string;
  args: Record<string, unknown>;
  workspace: string;
  userId: string;
  command?: string;
  filePaths?: string[];
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason?: string;
  autoApprove?: boolean;
}

// ============================================================================
// Pi 原生事件（来自 Pi SDK，用于 events.ts 翻译）
// Phase 5: 完整类型定义，支持所有 Pi SDK 事件
// ============================================================================

/**
 * Pi SDK 事件基类型
 * 
 * 支持的事件类型：
 * - agent_message / assistant_message: Agent 输出消息
 * - tool_call / tool_invocation: 工具调用
 * - tool_result / tool_execution_end: 工具执行结果
 * - tool_execution_error / tool_error: 工具执行错误
 * - error / session_error / fatal_error: 通用错误
 * - session_started / run_started: Session 启动
 * - session_completed / run_completed: Session 完成
 * - progress / step_progress: 执行进度
 * - approval_required / hil_approval: HIL 审批请求
 * - heartbeat / ping / system_info: 系统事件（不转发）
 */
export type PiEvent =
  | PiMessageEvent
  | PiToolCallEvent
  | PiToolResultEvent
  | PiToolErrorEvent
  | PiErrorEvent
  | PiSessionStartedEvent
  | PiSessionCompletedEvent
  | PiProgressEvent
  | PiApprovalRequiredEvent
  | PiSystemEvent
  | PiUnknownEvent;

/** Agent 消息事件 */
export interface PiMessageEvent {
  type: "agent_message" | "assistant_message" | "message";
  content?: string;
  delta?: string;
  [key: string]: unknown;
}

/** 工具调用事件 */
export interface PiToolCallEvent {
  type: "tool_call" | "tool_invocation";
  eventId?: string;
  tool?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  callId?: string;
  id?: string;
  [key: string]: unknown;
}

/** 工具结果事件 */
export interface PiToolResultEvent {
  type: "tool_result" | "tool_execution_end" | "tool_response";
  callId?: string;
  id?: string;
  result?: unknown;
  output?: unknown;
  success?: boolean;
  error?: boolean;
  [key: string]: unknown;
}

/** 工具错误事件 */
export interface PiToolErrorEvent {
  type: "tool_execution_error" | "tool_error";
  callId?: string;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

/** 通用错误事件 */
export interface PiErrorEvent {
  type: "error" | "session_error" | "fatal_error";
  message?: string;
  error?: string;
  [key: string]: unknown;
}

/** Session 启动事件 */
export interface PiSessionStartedEvent {
  type: "session_started" | "run_started" | "agent_started";
  sessionId?: string;
  runId?: string;
  id?: string;
  [key: string]: unknown;
}

/** Session 完成事件 */
export interface PiSessionCompletedEvent {
  type: "session_completed" | "run_completed" | "agent_completed";
  result?: SubAgentResult | Record<string, unknown>;
  [key: string]: unknown;
}

/** 进度事件 */
export interface PiProgressEvent {
  type: "progress" | "step_progress" | "execution_progress";
  message?: string;
  status?: string;
  percent?: number;
  progress?: number;
  [key: string]: unknown;
}

/** HIL 审批请求事件 */
export interface PiApprovalRequiredEvent {
  type: "approval_required" | "hil_approval" | "human_approval_required";
  callId?: string;
  id?: string;
  tool?: string;
  toolName?: string;
  args?: unknown;
  parameters?: unknown;
  reason?: string;
  message?: string;
  [key: string]: unknown;
}

/** 系统事件（不转发到 SubAgent 层） */
export interface PiSystemEvent {
  type: "heartbeat" | "ping" | "system_info";
  [key: string]: unknown;
}

/** 未知事件（兜底类型） */
export interface PiUnknownEvent {
  type: string;
  [key: string]: unknown;
}
