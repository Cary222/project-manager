/**
 * Pi SubAgent 实现
 *
 * Phase 2: Mock 实现，使用 createMockEventStream
 * Phase 3: 接入真实 Pi SDK + Policy Gateway
 */

import type {
  BaseSubAgent,
  SubAgentHandle,
  SubAgentInput,
  SubAgentRun,
} from "../types";
import { createPiRuntime } from "./runtime";
import type { PiRuntime } from "./runtime";

// ============================================================================
// PiSubAgent 运行时存储（Phase 2 用内存存储，Phase 3 改用 DB）
// ============================================================================

const runStore = new Map<string, SubAgentRun>();
const handleStore = new Map<string, { cancel: () => Promise<void> }>();

// Pi Runtime 实例（Phase 3: 使用真实 SDK）
let piRuntime: PiRuntime | null = null;

async function getPiRuntime(): Promise<PiRuntime> {
  if (!piRuntime) {
    piRuntime = await createPiRuntime("sdk", {
      debug: process.env.NODE_ENV === "development",
    });
  }
  return piRuntime;
}

// ============================================================================
// PiSubAgent
// ============================================================================

export class PiSubAgent implements BaseSubAgent {
  readonly type = "pi";
  readonly displayName = "Pi Coding Agent";

  /**
   * 启动 Pi session
   *
   * Phase 2: 创建 mock session，返回固定事件流
   * Phase 3: 创建真实 Pi SDK session + Policy Gateway 集成
   */
  async start(
    run: SubAgentRun,
    input: SubAgentInput
  ): Promise<SubAgentHandle> {
    // 1. 获取 Pi Runtime
    const runtime = await getPiRuntime();
    
    // 2. 启动 Pi run（会自动注入 runtime context）
    // userId 来自 SubAgentInput，由 graph.ts 传递
    const piHandle = await runtime.start({
      prompt: input.prompt,
      workspace: input.workspace,
      userId: input.userId || "system",
      contextFiles: input.contextFiles,
    });

    // 3. 更新 run 状态
    const updatedRun: SubAgentRun = {
      ...run,
      status: "running",
      sessionId: piHandle.sessionId,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    runStore.set(run.runId, updatedRun);

    // 4. 创建 SubAgentHandle（直接使用 Pi Runtime 的事件流）
    const handle: SubAgentHandle = {
      runId: run.runId,
      sessionId: piHandle.sessionId,
      events: piHandle.events, // Phase 3: 使用真实 Pi SDK 事件流
      awaitCompletion: async () => {
        const result = await piHandle.awaitCompletion();
        return {
          runId: run.runId,
          status: result.status,
          artifacts: result.artifacts,
          summary: result.summary,
          error: result.error,
          durationMs: result.durationMs,
        };
      },
      cancel: async () => {
        await piHandle.abort();
        await this.cancel(run.runId);
      },
    };

    // 存储 cancel 函数
    handleStore.set(run.runId, { cancel: handle.cancel });

    return handle;
  }

  /**
   * 中断运行
   */
  async cancel(runId: string): Promise<void> {
    const run = runStore.get(runId);
    if (run) {
      run.status = "cancelled";
      run.updatedAt = Date.now();
      run.completedAt = Date.now();
      runStore.set(runId, run);
    }
    handleStore.delete(runId);
  }

  /**
   * 恢复被暂停的 run
   *
   * Phase 2: 暂不支持，抛出明确错误
   * Phase 3: 接入真实 Pi SDK resume
   */
  async resume(runId: string, userInput: string): Promise<SubAgentHandle> {
    const runtime = await getPiRuntime();
    const run = runStore.get(runId);
    
    if (!run || !run.sessionId) {
      throw new Error(`Cannot resume: Run ${runId} not found or missing sessionId`);
    }
    
    // Phase 3: 使用真实 Pi SDK resume
    const piHandle = await runtime.resume(run.sessionId);
    
    // 如果有 userInput，调用 followUp
    if (userInput) {
      await runtime.followUp(piHandle.runId, userInput);
    }
    
    // 更新 run 状态
    run.status = "running";
    run.updatedAt = Date.now();
    runStore.set(runId, run);
    
    // 创建新的 SubAgentHandle
    const handle: SubAgentHandle = {
      runId: run.runId,
      sessionId: piHandle.sessionId,
      events: piHandle.events,
      awaitCompletion: async () => {
        const result = await piHandle.awaitCompletion();
        return {
          runId: run.runId,
          status: result.status,
          artifacts: result.artifacts,
          summary: result.summary,
          error: result.error,
          durationMs: result.durationMs,
        };
      },
      cancel: async () => {
        await piHandle.abort();
        await this.cancel(run.runId);
      },
    };
    
    handleStore.set(runId, { cancel: handle.cancel });
    
    return handle;
  }

  /**
   * 获取 run 状态
   */
  getRun(runId: string): SubAgentRun | undefined {
    return runStore.get(runId);
  }
}

// ============================================================================
// Singleton export
// ============================================================================

let _instance: PiSubAgent | null = null;

export function getPiSubAgent(): PiSubAgent {
  if (!_instance) {
    _instance = new PiSubAgent();
  }
  return _instance;
}
