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
import type { AgentSession, CreateAgentSessionOptions, CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { prisma } from "@/shared/db/client";
import { resolveCredentialWithFallback, getUserProviderRecords, getSystemCredentials, type CredentialRecord } from "@/features/ai/llm/credentials/api-key-store";
import { getLocalModels } from "@/lib/unified-model-registry";
import { synthesizeSessionModelsConfig, type SessionModelsConfigHandle } from "@/features/ai/llm/pi-session-config";
import { withRetry } from "../error-recovery";
import type {
  PiRuntime,
  PiRunInput,
  PiRunHandle,
  PiRunResult,
  PiRunStatus,
} from "../runtime";
import { translateEvents } from "../events";
import { injectRuntimeContext } from "../context";
import type { PolicyContext, PiEvent } from "../../types";

/**
 * Pi SDK Transport 类型定义
 * 
 * 定义 SDK 类型接口以替代 `as any` 类型断言
 */

/**
 * createPiSession 的参数类型（对应 SDK 的 CreateAgentSessionOptions）
 */
type PiSessionOptions = Pick<
  CreateAgentSessionOptions,
  "cwd" | "modelRuntime" | "model"
>;

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
  private runStore = new Map<string, PiRunHandle>();
  private sessionStore = new Map<string, AgentSession>(); // sessionId → Pi SDK session
  private pausedRuns = new Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }>(); // runId → HIL 等待中的 promise resolver
  private registeredTools: unknown[] = []; // Phase 4: 注册的业务工具
  // Stage 8：会话级临时 models.json 句柄（合成失败时回落默认行为）
  private sessionConfigCleanups = new Map<string, SessionModelsConfigHandle>();
  
  constructor() {}
  
  /**
   * 注册业务工具到 Runtime（Phase 4）
   */
  registerTool(tool: unknown): void {
    this.registeredTools.push(tool);
  }
  
  /**
   * 获取已注册的工具列表（Phase 4）
   */
  getRegisteredTools(): string[] {
    return this.registeredTools.map((tool: unknown) => (tool as { name?: string })?.name || "unknown");
  }
  
  /**
   * 启动新 run
   * 
   * Phase 5: 真实 Pi SDK 集成
   */
  async start(input: PiRunInput): Promise<PiRunHandle> {
    const runId = this.generateRunId();
    // Provisional ID is only used until Pi SDK creates the file-backed session.
    const provisionalSessionId = input.sessionId ?? this.generateSessionId();
    
    // 0. 持久化 SubAgentRun 到数据库
    try {
      await prisma.subAgentRun.create({
        data: {
          id: runId,
          runId,
          sessionId: provisionalSessionId,
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
    const { session: piSession, sessionConfig } = await this.createPiSession(input);
    // Pi Web can restore only the SDK's real file-backed session ID, not our
    // provisional run identifier.
    const sessionId = piSession.sessionId || provisionalSessionId;
    this.sessionStore.set(sessionId, piSession);
    if (sessionConfig) {
      this.sessionConfigCleanups.set(sessionId, sessionConfig);
    }
    await prisma.subAgentRun.updateMany({
      where: { id: runId, sessionId: provisionalSessionId },
      data: { sessionId },
    });
    
    // 4. 注册 tool_call hook（Policy Gateway 前置拦截）
    // TODO Phase 5 P1: 集成 Policy Gateway
    
    // 5. 先创建事件流订阅（必须在 sendUserMessage 之前，避免死锁）
    const piEvents = this.createPiEventStream(piSession, runId);
    const events = translateEvents(
      piEvents as AsyncIterable<PiEvent>,
      runId
    );
    
    // 6. 发送用户消息
    // 注意：模型已在 createAgentSession 时指定，不需要在 sendUserMessage 中重复指定
    piSession.sendUserMessage(input.prompt).catch((err: Error) => {
      console.error("[PiSdkRuntime] sendUserMessage failed:", err);
    });
    
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
      // DB 无凭证时回落 models.json：local provider 的 apiKey 存在
      // ~/.pi/agent/models.json（Pi runtime 直接读取）。存在即视为可用。
      const providerName = provider || "deepseek";
      try {
        const local = await getLocalModels();
        if (local.providers?.[providerName]?.apiKey) {
          return; // 可用，真正注入由 createPiSession() 完成
        }
      } catch (err) {
        console.warn(
          "[PiSdkRuntime] models.json credential fallback failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
      throw new Error(
        `No API key found for provider "${providerName}". ` +
        `Please configure your API key in Settings.`
      );
    }
    
    console.log(
      `[PiSdkRuntime] Using ${cred.ownerType} credential for ${provider || "deepseek"} ` +
      `(transport: ${cred.transport}, apiFormat: ${cred.apiFormat})`
    );
    
    // ✅ Stage 3 P3: 不再设置 process.env，凭证通过 createPiSession() 中的
    // modelRuntime.setRuntimeApiKey() 注入，提供实例级别隔离。
    // 
    // 职责边界：
    // - setupCredentials(): 凭证解析和验证
    // - createPiSession(): 凭证注入到 ModelRuntime（通过 setRuntimeApiKey）
    //
    // Pi SDK 不读取 process.env 中的 API key，真正生效的是 RuntimeCredentials.overrides Map。
    // 参考: docs/ai/Stage3-P2-Credential-Runtime-Research.md
  }
  
  /**
   * 创建 Pi session
   * 
   * Phase 5: 真实 Pi SDK 集成
   * Phase 5 P1: 添加重试机制
   * Phase 5 P0 修复：使用 setRuntimeApiKey 注册凭证，从用户 DB 配置获取模型
   */
  private async createPiSession(input: PiRunInput): Promise<{
    session: AgentSession;
    sessionConfig: SessionModelsConfigHandle | null;
  }> {
    // 使用重试机制创建 session（网络临时故障可重试）
    return await withRetry(
      async () => {
        console.log("[PiSdkRuntime] Creating fresh ModelRuntime...");

        // Stage 8：会话级临时 models.json（workspace 优先 + 站点模型补充 + 偏好注入）。
        // 合成失败时回落默认行为（不阻断会话）。
        let sessionConfig: SessionModelsConfigHandle | null = null;
        try {
          sessionConfig = await synthesizeSessionModelsConfig(input.userId || "system");
        } catch (error) {
          console.warn(
            "[PiSdkRuntime] session models.json synthesis failed, falling back to default config:",
            error instanceof Error ? error.message : String(error),
          );
        }

        const modelRuntime = await ModelRuntime.create({
          allowModelNetwork: false,
          refreshOnCreate: false,
          ...(sessionConfig ? { modelsPath: sessionConfig.modelsPath } : {}),
        } as CreateModelRuntimeOptions);
        console.log("[PiSdkRuntime] ModelRuntime created");
        
        // ============================================================
        // Phase 5 P0 关键修复：从用户 DB 配置获取凭证和模型
        // ============================================================
        
        const userId = input.userId || "system";
        console.log(`[PiSdkRuntime] Resolving credentials for userId=${userId}`);
        
        // 1. 从用户 API Key 配置获取凭证
        // 优先顺序：input.provider → 用户的其他 provider → SYSTEM 凭证 → models.json → ENV 环境变量
        let providerName = input.provider;
        let cred: CredentialRecord | null = null;

        if (providerName) {
          cred = await resolveCredentialWithFallback(userId, providerName);
        }

        // 如果用户指定的 provider 没有有效凭证，或者未指定 provider：
        // 尝试从用户的其他已配置 provider 中获取
        if (!cred) {
          const userProviders = await getUserProviderRecords(userId);
          for (const up of userProviders) {
            const candidate = await resolveCredentialWithFallback(userId, up.provider);
            if (candidate?.apiKey) {
              cred = candidate;
              providerName = candidate.provider;
              break;
            }
          }
        }

        // 尝试从全局 SYSTEM 凭证中获取
        if (!cred) {
          try {
            const sysCreds = await getSystemCredentials();
            for (const sc of sysCreds) {
              if (sc.apiKey) {
                cred = sc;
                providerName = sc.provider;
                break;
              }
            }
          } catch (err) {
            console.warn("[PiSdkRuntime] System credentials fallback failed:", err);
          }
        }

        // 尝试从本地 ~/.pi/agent/models.json 中获取
        if (!cred) {
          try {
            const local = await getLocalModels();
            for (const [pName, pConfig] of Object.entries(local.providers ?? {})) {
              if (pConfig?.apiKey) {
                cred = {
                  provider: pName,
                  baseURL: "",
                  apiKey: pConfig.apiKey,
                  transport: "direct",
                  apiFormat: "openai-chat",
                  ownerType: "USER",
                };
                providerName = pName;
                break;
              }
            }
          } catch (err) {
            console.warn(
              "[PiSdkRuntime] models.json credential fallback failed:",
              err instanceof Error ? err.message : String(err),
            );
          }
        }

        // 尝试从常见环境变量中兜底
        if (!cred) {
          const envFallbacks: Array<{ provider: string; envVar: string }> = [
            { provider: "deepseek", envVar: "DEEPSEEK_API_KEY" },
            { provider: "openai", envVar: "OPENAI_API_KEY" },
            { provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
            { provider: "agnes", envVar: "AGNES_API_KEY" },
            { provider: "qwen", envVar: "QWEN_API_KEY" },
            { provider: "dashscope", envVar: "DASHSCOPE_API_KEY" },
          ];
          for (const item of envFallbacks) {
            const envVal = process.env[item.envVar];
            if (envVal) {
              cred = {
                provider: item.provider,
                baseURL: "",
                apiKey: envVal,
                transport: "direct",
                apiFormat: "openai-chat",
                ownerType: "SYSTEM",
              };
              providerName = item.provider;
              break;
            }
          }
        }

        if (!cred || !providerName) {
          throw new Error(`未检测到可用的 API Key 凭证（用户 ID: ${userId}）。请在「设置」->「模型设置」中配置 API Key，或联系管理员配置全局系统凭证。`);
        }
        
        console.log(`[PiSdkRuntime] Using credential from ${cred.ownerType} provider: ${providerName}`);
        
        // 2. Register API key to ModelRuntime.
        // Provider names are canonical: "deepseek" stays "deepseek", etc.
        // The SDK's getModel(providerId, modelId) indexes by the model's provider field,
        // so setRuntimeApiKey must use the same providerId.
        console.log(`[PiSdkRuntime] Registering API key for provider: ${providerName}`);
        await modelRuntime.setRuntimeApiKey(providerName, cred.apiKey);
        
        // 验证认证状态
        const authStatus = modelRuntime.getProviderAuthStatus(providerName);
        console.log(`[PiSdkRuntime] Auth status for ${providerName}:`, authStatus);
        
        if (!authStatus.configured) {
          throw new Error(`Failed to configure authentication for provider: ${providerName}`);
        }
        
        // 3. 从用户可用模型中选择合适的模型
        console.log("[PiSdkRuntime] Discovering available models...");
        
        let selectedModel = null;
        
        if (input.model?.name) {
          // 用户指定了模型
          const modelName = input.model.name;
          console.log(`[PiSdkRuntime] Looking for user-specified model: ${providerName}/${modelName}`);
          selectedModel = modelRuntime.getModel(providerName, modelName);
          
          if (!selectedModel) {
            // First getModel already tried providerName; no need to retry
          }
        }
        
        if (!selectedModel) {
          // 没有指定模型或没找到，使用用户配置的默认模型
          const available = await modelRuntime.getAvailable();
          console.log(`[PiSdkRuntime] Available models:`, available.map(m => `${m.provider}/${m.id}`));
          
          // 优先选择与凭证 provider 匹配的模型
          const matchingModels = available.filter(m => m.provider === providerName);
          
          if (matchingModels.length > 0) {
            // 选择第一个匹配的模型
            selectedModel = matchingModels[0];
            console.log(`[PiSdkRuntime] Selected matching model: ${selectedModel.provider}/${selectedModel.id}`);
          } else if (available.length > 0) {
            // 没有匹配的，使用第一个可用模型
            selectedModel = available[0];
            console.log(`[PiSdkRuntime] No matching model, using first available: ${selectedModel.provider}/${selectedModel.id}`);
          }
        }
        
        if (!selectedModel) {
          throw new Error(`No available models found for provider: ${providerName}`);
        }
        
        console.log(`[PiSdkRuntime] Using model: ${selectedModel.provider}/${selectedModel.id}`);
        
        // 4. 创建 AgentSession
        console.log("[PiSdkRuntime] Creating AgentSession...");
        const result = await createAgentSession({
          cwd: input.workspace || process.cwd(),
          modelRuntime: modelRuntime,
          model: selectedModel,
        } as PiSessionOptions);
        
        const { session } = result;
        console.log(`[PiSdkRuntime] AgentSession created`);
        
        return { session, sessionConfig };
      },
      {
        maxAttempts: 3,
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
    session: AgentSession,
    runId: string
  ): AsyncIterable<PiEvent> {
    console.log(`[PiSdkRuntime] Starting event stream for runId=${runId}`);
    
    // 1. 发送 session_started 事件
    // SAFETY: Pi AgentSession object may expose sessionId or id depending on SDK version
    const sessionObj = session as unknown as { sessionId?: string; id?: string };
    yield {
      type: "session_started",
      runId,
      sessionId: sessionObj?.sessionId || sessionObj?.id || runId,
    } as PiEvent;
    
    // 2. 使用队列桥接回调 API 到异步迭代器
    const eventQueue: PiEvent[] = [];
    let isCompleted = false;
    let resolveNext: ((value: IteratorResult<PiEvent>) => void) | null = null;
    
    // 订阅 Pi SDK 事件（回调 API）
    console.log(`[PiSdkRuntime] Subscribing to Pi SDK events for runId=${runId}`);
    const unsubscribe = session.subscribe((event: unknown) => {
      console.log(`[PiSdkRuntime] Received Pi SDK event:`, event);
      
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
          // 完成时使用无 value 的结构，TypeScript IteratorResult 会正确处理
          resolveNext({ done: true } as IteratorResult<PiEvent>);
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
          await new Promise<IteratorResult<PiEvent>>((resolve) => {
            resolveNext = resolve;
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
  private mapPiSdkEvent(sdkEvent: unknown, runId: string): PiEvent | null {
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
      ...(sdkEvent as Record<string, unknown>),
      runId,
    } as PiEvent;
  }
  
  /**
   * 检查是否为完成事件
   * 
   * Phase 5 P0: Pi SDK 0.84.2 使用 agent_settled 作为完成事件
   */
  private isCompletionEvent(event: unknown): boolean {
    if (!event || typeof event !== "object") return false;
    
    const type = (event as { type?: string }).type;
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

    // 4. Stage 8：清理会话级临时 models.json
    this.cleanupSessionConfig(handle.sessionId);
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

  protected async checkPolicy(
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
        
        // Stage 8：清理会话级临时 models.json
        this.cleanupSessionConfig(handle.sessionId);

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
    
    // Stage 8：清理会话级临时 models.json
    this.cleanupSessionConfig(handle.sessionId);

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

  /** Stage 8：清理会话级临时 models.json（幂等） */
  private cleanupSessionConfig(sessionId: string): void {
    const config = this.sessionConfigCleanups.get(sessionId);
    if (!config) return;
    config.cleanup();
    this.sessionConfigCleanups.delete(sessionId);
  }

  private generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
  
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
