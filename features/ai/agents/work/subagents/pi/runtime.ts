/**
 * Pi Runtime 接口
 *
 * Phase 3: 基于官方 Pi SDK 的 Runtime 抽象层
 * 
 * 架构：
 * - PiRuntime 接口（抽象层）
 * - Transport 实现（sdk.ts / rpc.ts）
 * - Session 管理（session ID + run ID）
 */

import type { SubAgentEvent } from "../types";

// ─── Pi Runtime 输入───────────────────────────────────────────────

export interface PiRunInput {
  /** 用户 prompt */
  prompt: string;
  
  /** 工作目录（绝对路径） */
  workspace: string;
  
  /** Session ID（用于恢复 session） */
  sessionId?: string;
  
  /** 额外上下文文件（如 AGENTS.md） */
  contextFiles?: string[];
  
  /** 用户 ID（用于审计） */
  userId?: string;
  
  /** LLM Provider（Phase 5: deepseek / openai / ...） */
  provider?: string;
  
  /** 模型配置 */
  model?: {
    provider: string;
    name: string;
  };
}

// ─── Pi Runtime 句柄───────────────────────────────────────────────

export interface PiRunHandle {
  /** Run ID（唯一标识） */
  runId: string;
  
  /** Session ID（持久化 session） */
  sessionId: string;
  
  /** 事件流（异步迭代器） */
  events: AsyncIterable<SubAgentEvent>;
  
  /** 等待完成（返回最终结果） */
  awaitCompletion(): Promise<PiRunResult>;
  
  /** 取消运行 */
  abort(): Promise<void>;
}

// ─── Pi Runtime 结果───────────────────────────────────────────────

export interface PiRunResult {
  runId: string;
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  artifacts: Record<string, unknown>;
  summary?: string;
  error?: string;
  durationMs: number;
}

// ─── Pi Runtime 接口（抽象层）─────────────────────────────────────

export interface PiRuntime {
  /**
   * 启动新 run（或恢复 session）
   */
  start(input: PiRunInput): Promise<PiRunHandle>;
  
  /**
   * 插入新任务（steer）
   */
  steer(runId: string, input: string): Promise<void>;
  
  /**
   * 用户介入后继续（follow-up）
   */
  followUp(runId: string, input: string): Promise<void>;
  
  /**
   * 取消运行
   */
  abort(runId: string): Promise<void>;
  
  /**
   * 恢复 session
   */
  resume(sessionId: string): Promise<PiRunHandle>;
  
  /**
   * 获取 run 状态
   */
  getRunStatus(runId: string): Promise<PiRunStatus | null>;
}

// ─── Pi Run 状态──────────────────────────────────────────────────

export interface PiRunStatus {
  runId: string;
  sessionId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ─── Pi Runtime 工厂函数───────────────────────────────────────────

export type PiTransportMode = "sdk" | "rpc";

/**
 * 创建 Pi Runtime 实例
 * 
 * @param mode - 传输模式（sdk / rpc）
 * @param options - 额外配置
 */
export async function createPiRuntime(
  mode: PiTransportMode = "sdk",
  options?: PiRuntimeOptions
): Promise<PiRuntime> {
  if (mode === "sdk") {
    // 动态导入 SDK transport（避免循环依赖）
    const { PiSdkRuntime } = await import("./transports/sdk");
    return new PiSdkRuntime(options);
  }
  
  if (mode === "rpc") {
    // 动态导入 RPC transport（Phase 3 暂不实现）
    throw new Error("RPC transport not implemented in Phase 3");
  }
  
  throw new Error(`Unknown transport mode: ${mode}`);
}

// ─── Pi Runtime 配置──────────────────────────────────────────────

export interface PiRuntimeOptions {
  /** 默认模型 */
  defaultModel?: {
    provider: string;
    name: string;
  };
  
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  
  /** 是否启用调试日志 */
  debug?: boolean;
  
  /** Pi SDK 配置（SDK transport 专用） */
  sdkOptions?: {
    /** Pi 工作目录 */
    piWorkspace?: string;
    
    /** 是否启用 sandbox */
    sandbox?: boolean;
  };
  
  /** RPC 配置（RPC transport 专用） */
  rpcOptions?: {
    /** RPC server 地址 */
    serverUrl?: string;
    
    /** 超时时间 */
    timeoutMs?: number;
  };
}
