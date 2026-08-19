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
    // Phase 5 P0 修复：必须明确指定模型，否则 Pi SDK 会报 "No API key found"
    const modelName = input.model?.name || "deepseek-v4-flash"; // 默认使用 deepseek-v4-flash
    await piSession.sendUserMessage(input.prompt, { model: modelName } as any);
    
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
   * Phase 5 P0 修复：使用 setRuntimeApiKey 注册凭证
   */
  private async createPiSession(input: PiRunInput): Promise<any> {
    // 使用重试机制创建 session（网络临时故障可重试）
    return await withRetry(
      async () => {
        // Phase 5 P0 修复：每次都创建新的 ModelRuntime
        console.log("[PiSdkRuntime] Creating fresh ModelRuntime...");
        
        const modelRuntime = await ModelRuntime.create({
          allowModelNetwork: false,
          refreshOnCreate: false,
        } as any);
        console.log("[PiSdkRuntime] ModelRuntime created");
        
        // Phase 5 P0 关键修复：使用 setRuntimeApiKey 注册 API key
        // 仅仅设置环境变量是不够的，Pi SDK 需要通过 setRuntimeApiKey 注册凭证
        const providerName = input.provider || "deepseek";
        const apiKey = providerName === "deepseek" 
          ? process.env.DEEPSEEK_API_KEY
          : providerName === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY;
        
        if (!apiKey) {
          throw new Error(`API key not found in environment for provider: ${providerName}`);
        }
        
        // 注册到 Pi SDK（使用 openai provider，因为 DeepSeek 兼容 OpenAI API）
        const providerKey = providerName === "deepseek" ? "openai" : providerName;
        const baseUrl = providerName === "deepseek" 
          ? "https://api.deepseek.com"
          : process.env.OPENAI_API_BASE_URL;
        
        console.log(`[PiSdkRuntime] Registering API key for provider: ${providerKey}`);
        await modelRuntime.setRuntimeApiKey(
          providerKey, 
          apiKey, 
          baseUrl ? { baseUrl } as any : undefined
        );
        
        // 验证认证状态
        const authStatus = modelRuntime.getProviderAuthStatus(providerKey);
        console.log(`[PiSdkRuntime] Auth status for ${providerKey}:`, authStatus);
        
        if (!authStatus.configured) {
          throw new Error(`Failed to configure authentication for provider: ${providerKey}`);
        }
        
        // 2. 创建 session
        console.log("[PiSdkRuntime] Creating AgentSession...");
        
        const result = await createAgentSession({
          cwd: input.workspace || process.cwd(),
          modelRuntime: modelRuntime,
        } as any);
        
        const { session } = result;
        console.log(`[PiSdkRuntime] AgentSession created`);
        
        // 更新缓存
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
   * Phase 5 P0 修复：使用回调 API 而不是异步迭代器
   * 
   * Pi SDK 的 subscribe() 接受回调函数，不返回异步迭代器
   */
  private async *createPiEventStream(
    session: any, // Pi SDK AgentSession 类型
    runId: string
  ): AsyncIterable<PiEvent> {
    console.log(`[PiSdkRuntime] Starting event stream for runId=${runId}`);
    
    // 1. 发送 session_started 事件
    yield {
      type: "session_started",
      runId,
      sessionId: session.sessionId || session.id || runId,
    } as PiEvent;
    
    // 2. 使用队列桥接回调 API 到异步迭代器
    const eventQueue: PiEvent[] = [];
    let isCompleted = false;
    let resolveNext: ((value: IteratorResult<PiEvent>) => void) | null = null;
    let rejectNext: ((error: Error) => void) | null = null;
    
    // 订阅 Pi SDK 事件（回调 API）
    const unsubscribe = session.subscribe((event: any) => {
      // 转换 Pi SDK 原生事件 → PiEvent
      const piEvent = this.mapPiSdkEvent(event, runId);
      if (piEvent) {
        eventQueue.push(piEvent);
        
        // 如果有等待中的 promise，立即 resolve
        if (resolveNext) {
          resolveNext({ value: eventQueue.shift()!, done: false });
          resolveNext = null;
        }
      }
      
      // 检查是否完成
      if (this.isCompletionEvent(event)) {
        console.log(`[PiSdkRuntime] Session completed for runId=${runId}`);
        isCompleted = true;
        unsubscribe(); // 取消订阅
        
        // 如果有等待中的 promise，通知完成
        if (resolveNext) {
          resolveNext({ value: undefined as any, done: true });
          resolveNext = null;
        }
      }
    });
    
    // 3. 生成器循环：从队列中 yield 事件
    try {
      while (!isCompleted || eventQueue.length > 0) {
        // 如果队列有事件，立即 yield
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
          continue;
        }
        
        // 队列为空，等待下一个事件
        if (!isCompleted) {
          await new Promise<IteratorResult<PiEvent>>((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
          });
        }
      }
      
      console.log(`[PiSdkRuntime] Event stream ended for runId=${runId}`);
      
    } catch (error) {
      console.error("[PiSdkRuntime] Event stream error:", error);
      unsubscribe();
      
      // 发送错误事件
      yield {
        type: "error",
        runId,
        message: error instanceof Error ? error.message : String(error),
      } as PiEvent;
    } finally {
      unsubscribe();
      
      // 发送 session_completed
      yield {
        type: "session_completed",
        runId,
        result: {
          runId,
          status: isCompleted ? "completed" : "failed",
          artifacts: {},
          durationMs: 0,
        },
      } as PiEvent;
    }
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
   * 
   * Phase 5 P0: Pi SDK 0.84.2 使用 agent_settled 作为完成事件
   */
  private isCompletionEvent(event: any): boolean {
    if (!event || typeof event !== "object") return false;
    
    const type = event.type as string;
    return (
      type === "agent_settled" ||      // Pi SDK 实际完成事件
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
    for (const [runId, handle] of Array.from(this.runStore.entries())) {
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
