/**
 * Pi SDK Transport
 *
 * Phase 3: 基于 Pi SDK 的 Runtime 实现
 * Phase 4 P1: SubAgentRun 持久化到数据库
 * Phase 5 P0: 真实 Pi SDK 集成 + 用户凭证管理
 * 
 * 架构：
 * - 使用 @earendil-works/pi-coding-agent 真实 SDK
 * - 从 UserApiKey 表获取用户 LLM 凭证
 * - 事件流转换（Pi native → SubAgentEvent）
 * - Policy Gateway 前置拦截（tool_call hook）
 * - SubAgentRun 生命周期管理（DB）
 */

import { createAgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { prisma } from "@/shared/db/client";
import { resolveCredentialWithFallback } from "@/features/ai/llm/credentials/api-key-store";
import { withRetry, classifyError, ErrorType } from "../error-recovery";
import type {
  PiRuntime,
  PiRunInput,
  PiRunHandle,
  PiRunResult,
  PiRunStatus,
  PiRuntimeOptions,
} from "../runtime";
import { translateEvents } from "../events";
import { injectRuntimeContext } from "../context";
import type { PolicyContext, PiEvent } from "../../types";

/**
 * 获取 Policy Gateway（延迟导入避免循环依赖）
 */
async function getPolicyGatewayInstance() {
  const { getPolicyGateway } = await import(
    /* webpackIgnore: true */
    "../../../policy/index"
  );
  return getPolicyGateway();
}

// ─── Pi SDK Transport 实现────────────────────────────────────────

export class PiSdkRuntime implements PiRuntime {
  private options: PiRuntimeOptions;
  private runStore = new Map<string, PiRunHandle>();
  private sessionStore = new Map<string, AgentSession>(); // sessionId → Pi SDK session
  private pausedRuns = new Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }>(); // runId → HIL 等待中的 promise resolver
  private modelRuntime: ModelRuntime | null = null; // 全局 ModelRuntime（复用）
  
  constructor(options?: PiRuntimeOptions) {
    this.options = options ?? {};
  }
  
  /**
   * 启动新 run
   * 
   * Phase 5: 真实 Pi SDK 集成
   */
  async start(input: PiRunInput): Promise<PiRunHandle> {
    const runId = this.generateRunId();
    const sessionId = input.sessionId ?? this.generateSessionId();
    
    // 0. 持久化 SubAgentRun 到数据库
    try {
      await prisma.subAgentRun.create({
        data: {
          id: runId,
          runId,
          sessionId,
          agentType: "pi",
          userId: input.userId || "system",
          workspaceId: input.workspace || "/tmp",
          prompt: input.prompt,
          contextFiles: input.contextFiles || [],
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[PiSdkRuntime] Failed to persist SubAgentRun:", error);
      // 非致命错误，继续执行
    }
    
    // 1. 注入运行时上下文（.projecthub/AGENT_CONTEXT.md）
    try {
      await injectRuntimeContext(
        {
          workspace: input.workspace,
          prompt: input.prompt,
          contextFiles: input.contextFiles,
        },
        {
          runId,
          userId: input.userId || "system",
          userName: "User", // TODO: 从用户信息获取
        }
      );
    } catch (error) {
      console.error("[PiSdkRuntime] Failed to inject context:", error);
      // 非致命错误，继续执行
    }
    
    // 2. 配置 LLM 凭证（从数据库获取用户 API key）
    await this.setupCredentials(input.userId, input.provider);
    
    // 3. 创建 Pi session（真实 Pi SDK）
    const piSession = await this.createPiSession(input);
    this.sessionStore.set(sessionId, piSession);
    
    // 4. 注册 tool_call hook（Policy Gateway 前置拦截）
    // TODO Phase 5 P1: 集成 Policy Gateway
    
    // 5. 发送用户消息
    await piSession.sendUserMessage(input.prompt);
    
    // 6. 转换事件流（Pi native → SubAgentEvent）
    const piEvents = this.createPiEventStream(piSession, runId);
    const events = translateEvents(
      piEvents as AsyncIterable<PiEvent>,
      runId
    );
    
    // 7. 创建 handle
    const handle: PiRunHandle = {
      runId,
      sessionId,
      events,
      awaitCompletion: async () => {
        return this.awaitCompletion(runId);
      },
      abort: async () => {
        await this.abort(runId);
      },
    };
    
    // 8. 存储 handle
    this.runStore.set(runId, handle);
    
    return handle;
  }
  
  /**
   * 配置 LLM 凭证
   * 
   * Phase 5: 从数据库读取用户配置的 API key
   * Phase 5 P1: 添加重试机制
   * 
   * ⚠️ 安全注意：此方法会修改 process.env（全局状态）
   * TODO Phase 6: 研究 Pi SDK 是否支持运行时传递凭证（避免全局污染）
   */
  private async setupCredentials(
    userId: string | undefined,
    provider?: string
  ): Promise<void> {
    if (!userId) {
      console.warn("[PiSdkRuntime] No userId provided, using env fallback");
      return;
    }
    
    // 使用重试机制获取凭证（网络/数据库临时故障可重试）
    const cred = await withRetry(
      async () => {
        const providerName = provider || "deepseek";
        return await resolveCredentialWithFallback(userId, providerName, {
          apiKey: process.env.OPENAI_API_KEY || "",
          baseURL: process.env.OPENAI_API_BASE_URL || "",
        });
      },
      {
        maxAttempts: 2, // 凭证获取最多重试 2 次
        baseDelay: 500,
      }
    );
    
    if (!cred) {
      throw new Error(
        `No API key found for provider "${provider || "deepseek"}". ` +
        `Please configure your API key in Settings.`
      );
    }
    
    console.log(
      `[PiSdkRuntime] Using ${cred.ownerType} credential for ${provider || "deepseek"} ` +
      `(transport: ${cred.transport}, apiFormat: ${cred.apiFormat})`
    );
    
    // ⚠️ 设置环境变量（Pi SDK 会读取）
    // 注意：这会修改全局 process.env，多租户场景有隔离风险
    // Phase 5 P0 修复：根据 provider 设置正确的环境变量名
    const providerName = provider || "deepseek";
    
    if (providerName === "deepseek") {
      process.env.DEEPSEEK_API_KEY = cred.apiKey;
      console.log(`[PiSdkRuntime] Set DEEPSEEK_API_KEY (length: ${cred.apiKey.length})`);
    } else if (providerName === "openai") {
      process.env.OPENAI_API_KEY = cred.apiKey;
      console.log(`[PiSdkRuntime] Set OPENAI_API_KEY (length: ${cred.apiKey.length})`);
    } else if (providerName === "anthropic") {
      process.env.ANTHROPIC_API_KEY = cred.apiKey;
      console.log(`[PiSdkRuntime] Set ANTHROPIC_API_KEY (length: ${cred.apiKey.length})`);
    } else {
      // 其他 provider 尝试通用 OPENAI_API_KEY
      process.env.OPENAI_API_KEY = cred.apiKey;
      if (cred.baseURL) {
        process.env.OPENAI_API_BASE_URL = cred.baseURL;
        console.log(`[PiSdkRuntime] Set OPENAI_API_BASE_URL to ${cred.baseURL}`);
      }
    }
  }
  
  /**
   * 创建 Pi session
   * 
   * Phase 5: 真实 Pi SDK 集成
   * Phase 5 P1: 添加重试机制
   */
  private async createPiSession(input: PiRunInput): Promise<any> {
    // 使用重试机制创建 session（网络临时故障可重试）
    return await withRetry(
      async () => {
        // Phase 5 P0 修复：每次都创建新的 ModelRuntime，确保读取最新的环境变量
        // 原因：ModelRuntime.create() 会在初始化时读取环境变量（DEEPSEEK_API_KEY 等）
        // 如果复用旧的 ModelRuntime，它不会感知到新设置的环境变量
        console.log("[PiSdkRuntime] Creating fresh ModelRuntime...");
        
        const modelRuntime = await ModelRuntime.create({
          allowModelNetwork: false,
          refreshOnCreate: false,
        } as any);
        console.log("[PiSdkRuntime] ModelRuntime created");
        
        // 2. 创建 session
        console.log("[PiSdkRuntime] Creating AgentSession...");
        
        const result = await createAgentSession({
          cwd: input.workspace || process.cwd(),
          modelRuntime: modelRuntime,
        } as any);
        
        const { session } = result;
        console.log(`[PiSdkRuntime] AgentSession created`);
        
        // 更新缓存（供后续可能的复用，虽然现在不复用了）
        this.modelRuntime = modelRuntime;
        
        return session;
      },
      {
        maxAttempts: 3, // Session 创建最多重试 3 次
        baseDelay: 1000,
      }
    );
  }
  
  /**
   * 创建 Pi 事件流
   * 
   * Phase 5 P0: 将 Pi SDK 的事件转换为 PiEvent
   * 
   * 注意：Pi SDK 的 session API 可能与预期不同
   */
  private async *createPiEventStream(
    session: any, // Pi SDK AgentSession 类型不明确
    runId: string
  ): AsyncIterable<PiEvent> {
    console.log(`[PiSdkRuntime] Starting event stream for runId=${runId}`);
    
    // 1. 发送 session_started 事件
    yield {
      type: "session_started",
      runId,
      sessionId: session.sessionId || session.id || runId, // 适配不同 SDK 版本
    } as PiEvent;
    
    try {
      // 2. 订阅 Pi SDK 事件流
      // Phase 5: subscribe() 可能需要参数或返回不同类型
      const events = typeof session.subscribe === "function" 
        ? session.subscribe() 
        : this.createFallbackEventStream(session, runId);
      
      for await (const event of events) {
        // 转换 Pi SDK 原生事件 → PiEvent
        const piEvent = this.mapPiSdkEvent(event, runId);
        if (piEvent) {
          yield piEvent;
        }
        
        // 检查是否完成
        if (this.isCompletionEvent(event)) {
          console.log(`[PiSdkRuntime] Session completed for runId=${runId}`);
          break;
        }
      }
    } catch (error) {
      console.error("[PiSdkRuntime] Event stream error:", error);
      
      // 发送错误事件
      yield {
        type: "error",
        runId,
        message: error instanceof Error ? error.message : String(error),
      } as PiEvent;
      
      // 发送 session_completed（失败）
      yield {
        type: "session_completed",
        runId,
        result: {
          runId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          artifacts: {},
          durationMs: 0,
        },
      } as PiEvent;
    }
  }
  
  /**
   * Fallback: 如果 Pi SDK 不支持 subscribe()，使用轮询方式
   */
  private async *createFallbackEventStream(
    session: any,
    runId: string
  ): AsyncIterable<any> {
    console.warn("[PiSdkRuntime] Pi SDK subscribe() not available, using fallback");
    
    // Phase 5: 实现 fallback 策略（轮询或其他方式）
    // 暂时抛出错误，提示需要适配 SDK
    throw new Error(
      "Pi SDK session.subscribe() not available. " +
      "Please check Pi SDK version and API documentation."
    );
  }
  
  /**
   * 映射 Pi SDK 原生事件 → PiEvent
   * 
   * Phase 5: 适配 Pi SDK 0.84.2 事件格式
   */
  private mapPiSdkEvent(sdkEvent: any, runId: string): PiEvent | null {
    // Pi SDK 事件结构可能为：
    // { type: "agent_message", content: "..." }
    // { type: "tool_call", tool: "read", args: {...} }
    // { type: "tool_result", callId: "...", result: {...} }
    
    if (!sdkEvent || typeof sdkEvent !== "object") {
      console.warn("[PiSdkRuntime] Invalid SDK event:", sdkEvent);
      return null;
    }
    
    // 直接返回事件（translateSingleEvent 会处理类型转换）
    return {
      ...sdkEvent,
      runId,
    } as PiEvent;
  }
  
  /**
   * 检查是否为完成事件
   */
  private isCompletionEvent(event: any): boolean {
    if (!event || typeof event !== "object") return false;
    
    const type = event.type as string;
    return (
      type === "session_completed" ||
      type === "run_completed" ||
      type === "agent_completed" ||
      type === "fatal_error"
    );
  }
  
  /**
   * 插入新任务（steer）
   * 
   * Phase 5: 集成真实 Pi SDK steer API
   */
  async steer(runId: string, input: string): Promise<void> {
    const handle = this.runStore.get(runId);
    if (!handle) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    const session = this.sessionStore.get(handle.sessionId);
    if (!session) {
      throw new Error(`Session not found for run: ${runId}`);
    }
    
    // TODO Phase 5: 调用 Pi SDK 的 steer API
    // await session.steer(input);
    
    console.log(`[PiSdkRuntime] steer() called: runId=${runId}, input="${input}"`);
    throw new Error("steer() not yet implemented in Phase 5");
  }
  
  /**
   * 用户介入后继续（follow-up）
   * 
   * Phase 4: 用于 HIL 审批后恢复执行
   * Phase 5: 集成真实 Pi SDK followUp API
   */
  async followUp(runId: string, input: string): Promise<void> {
    console.log(`[PiSdkRuntime] followUp for runId=${runId}, input="${input}"`);
    
    // 1. 检查 run 是否存在
    const handle = this.runStore.get(runId);
    if (!handle) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    // 2. 获取 Pi session
    const session = this.sessionStore.get(handle.sessionId);
    if (!session) {
      throw new Error(`Session not found for run: ${runId}`);
    }
    
    // 3. 检查是否有等待中的 HIL approval
    const pausedRun = this.pausedRuns.get(runId);
    if (!pausedRun) {
      console.warn(`[PiSdkRuntime] No paused run found for ${runId}, followUp ignored`);
      return;
    }
    
    // 4. 恢复执行（resolve promise）
    pausedRun.resolve(input);
    this.pausedRuns.delete(runId);
    
    console.log(`[PiSdkRuntime] followUp completed, run ${runId} resumed`);
    
    // TODO Phase 5: 调用真实 Pi SDK 的 followUp API
    // await session.sendUserMessage(input);
  }
  
  /**
   * 取消运行
   * 
   * Phase 5: 集成真实 Pi SDK abort API
   */
  async abort(runId: string): Promise<void> {
    const handle = this.runStore.get(runId);
    if (!handle) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    // 1. 获取 Pi session
    const session = this.sessionStore.get(handle.sessionId);
    if (session) {
      try {
        // 调用 Pi SDK abort API
        await session.abort();
        console.log(`[PiSdkRuntime] Pi session aborted: ${runId}`);
      } catch (error) {
        console.error(`[PiSdkRuntime] Failed to abort Pi session:`, error);
      }
    }
    
    // 2. 更新数据库状态为 CANCELLED
    try {
      await prisma.subAgentRun.update({
        where: { id: runId },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[PiSdkRuntime] Failed to update SubAgentRun status:", error);
    }
    
    // 3. 清理内存
    this.runStore.delete(runId);
    if (session) {
      this.sessionStore.delete(handle.sessionId);
    }
  }
  
  /**
   * 恢复 session
   * 
   * Phase 4: 用于从持久化状态恢复 session
   * Phase 5: TODO - 从数据库恢复 session 状态
   */
  async resume(sessionId: string): Promise<PiRunHandle> {
    console.log(`[PiSdkRuntime] resume sessionId=${sessionId}`);
    
    // 1. 检查内存中是否有现有 session
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(
        `Session not found: ${sessionId}. ` +
        `Cross-process session resume not yet implemented in Phase 5.`
      );
    }
    
    // 2. 查找对应的 runId（从 runStore 反查）
    let foundRunId: string | null = null;
    for (const [runId, handle] of this.runStore.entries()) {
      if (handle.sessionId === sessionId) {
        foundRunId = runId;
        break;
      }
    }
    
    if (!foundRunId) {
      throw new Error(`Run not found for session: ${sessionId}`);
    }
    
    const handle = this.runStore.get(foundRunId)!;
    console.log(`[PiSdkRuntime] resume found runId=${foundRunId} for sessionId=${sessionId}`);
    
    return handle;
  }
  
  /**
   * 获取 run 状态
   */
  async getRunStatus(runId: string): Promise<PiRunStatus | null> {
    const handle = this.runStore.get(runId);
    if (!handle) {
      // 尝试从数据库恢复状态
      try {
        const dbRun = await prisma.subAgentRun.findUnique({
          where: { id: runId },
        });
        
        if (dbRun) {
          return {
            runId: dbRun.runId,
            sessionId: dbRun.sessionId,
            status: dbRun.status.toLowerCase() as "running" | "completed" | "failed" | "cancelled",
            startedAt: dbRun.startedAt.toISOString(),
            completedAt: dbRun.completedAt?.toISOString(),
          };
        }
      } catch (error) {
        console.error("[PiSdkRuntime] Failed to query SubAgentRun:", error);
      }
      
      return null;
    }
    
    return {
      runId,
      sessionId: handle.sessionId,
      status: "running",
      startedAt: new Date().toISOString(),
    };
  }
  
  // ─── 私有方法：Policy Gateway 检查──────────────────────────

  private async checkPolicy(
    runId: string,
    toolCall: { tool: string; args: Record<string, unknown> },
    input: PiRunInput
  ): Promise<{ decision: "allow" | "approve" | "deny"; reason?: string }> {
    const gateway = await getPolicyGatewayInstance();
    
    const context: PolicyContext = {
      runId: runId || this.generateRunId(), // 使用传入的 runId 或生成新的
      tool: toolCall.tool,
      args: toolCall.args,
      workspace: input.workspace,
      userId: input.userId || "system",
    };
    
    return gateway.check(context);
  }
  
  // ─── 私有方法：等待完成─────────────────────────────────────

  private async awaitCompletion(runId: string): Promise<PiRunResult> {
    const handle = this.runStore.get(runId);
    if (!handle) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    // 收集所有事件直到 run_completed
    for await (const event of handle.events) {
      if (event.type === "run_completed") {
        // 更新数据库状态为 COMPLETED
        try {
          await prisma.subAgentRun.update({
            where: { id: runId },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
            },
          });
        } catch (error) {
          console.error("[PiSdkRuntime] Failed to update SubAgentRun status:", error);
        }
        
        return {
          runId: event.result.runId,
          sessionId: handle.sessionId,
          status: event.result.status as "completed" | "failed" | "cancelled",
          artifacts: event.result.artifacts ?? {},
          summary: event.result.summary,
          error: event.result.error,
          durationMs: event.result.durationMs ?? 0,
        };
      }
    }
    
    // 如果事件流结束但没有 run_completed，标记为 FAILED
    try {
      await prisma.subAgentRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[PiSdkRuntime] Failed to update SubAgentRun status:", error);
    }
    
    return {
      runId,
      sessionId: handle.sessionId,
      status: "failed",
      artifacts: {},
      error: "Event stream ended without run_completed",
      durationMs: 0,
    };
  }
  
  // ─── 私有方法：生成 ID──────────────────────────────────────

  private generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
  
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
