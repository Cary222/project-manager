/**
 * Phase 5 P1: 错误恢复机制
 * 
 * 功能：
 * 1. 自动重试：指数退避 + 最大重试次数
 * 2. 状态恢复：从数据库恢复中断的 run
 * 3. 降级策略：Pi SDK 失败后的 fallback
 * 4. 错误分类：可重试 vs 不可重试
 */

// ============================================================================
// 错误分类
// ============================================================================

/**
 * 错误类型分类
 */
export enum ErrorType {
  /** 可重试错误（网络、超时、临时故障） */
  RETRIABLE = "retriable",
  
  /** 不可重试错误（认证、权限、参数错误） */
  NON_RETRIABLE = "non_retriable",
  
  /** 致命错误（系统故障、资源耗尽） */
  FATAL = "fatal",
}

/**
 * 错误分类器
 */
export function classifyError(error: unknown): ErrorType {
  if (!error) return ErrorType.NON_RETRIABLE;
  
  const message = error instanceof Error ? error.message : String(error);
  const lowerMsg = message.toLowerCase();
  
  // 1. 网络/超时错误 → 可重试
  if (
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("network") ||
    lowerMsg.includes("fetch failed") ||
    lowerMsg.includes("502") ||
    lowerMsg.includes("503") ||
    lowerMsg.includes("504")
  ) {
    return ErrorType.RETRIABLE;
  }
  
  // 2. 认证/权限错误 → 不可重试
  if (
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("forbidden") ||
    lowerMsg.includes("401") ||
    lowerMsg.includes("403") ||
    lowerMsg.includes("api key") ||
    lowerMsg.includes("invalid token")
  ) {
    return ErrorType.NON_RETRIABLE;
  }
  
  // 3. 参数错误 → 不可重试
  if (
    lowerMsg.includes("invalid argument") ||
    lowerMsg.includes("invalid input") ||
    lowerMsg.includes("validation failed") ||
    lowerMsg.includes("400")
  ) {
    return ErrorType.NON_RETRIABLE;
  }
  
  // 4. 系统资源错误 → 致命
  if (
    lowerMsg.includes("out of memory") ||
    lowerMsg.includes("disk full") ||
    lowerMsg.includes("enomem") ||
    lowerMsg.includes("enospc")
  ) {
    return ErrorType.FATAL;
  }
  
  // 5. 默认：可重试（保守策略）
  return ErrorType.RETRIABLE;
}

// ============================================================================
// 重试策略
// ============================================================================

export interface RetryOptions {
  /** 最大重试次数 */
  maxAttempts: number;
  
  /** 基础延迟时间（毫秒） */
  baseDelay: number;
  
  /** 最大延迟时间（毫秒） */
  maxDelay: number;
  
  /** 退避因子（指数退避） */
  backoffFactor: number;
  
  /** 是否启用抖动（避免雷鸣群效应） */
  jitter: boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * 计算重试延迟时间（指数退避 + 抖动）
 */
export function calculateRetryDelay(
  attempt: number,
  options: RetryOptions
): number {
  // 1. 指数退避
  const exponentialDelay = Math.min(
    options.baseDelay * Math.pow(options.backoffFactor, attempt - 1),
    options.maxDelay
  );
  
  // 2. 添加抖动（±25%）
  if (options.jitter) {
    const jitterRange = exponentialDelay * 0.25;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;
    return Math.max(0, exponentialDelay + jitter);
  }
  
  return exponentialDelay;
}

/**
 * 带重试的异步函数执行器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // 执行函数
      return await fn();
    } catch (error) {
      lastError = error;
      
      // 分类错误
      const errorType = classifyError(error);
      
      // 致命错误或不可重试错误 → 立即失败
      if (errorType === ErrorType.FATAL || errorType === ErrorType.NON_RETRIABLE) {
        console.error(`[withRetry] Non-retriable error (attempt ${attempt}/${opts.maxAttempts}):`, error);
        throw error;
      }
      
      // 最后一次尝试失败 → 抛出错误
      if (attempt === opts.maxAttempts) {
        console.error(`[withRetry] Max attempts reached (${opts.maxAttempts}):`, error);
        throw error;
      }
      
      // 计算延迟时间并重试
      const delay = calculateRetryDelay(attempt, opts);
      console.warn(
        `[withRetry] Attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${Math.round(delay)}ms:`,
        error instanceof Error ? error.message : String(error)
      );
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  // 永远不会到达这里（TypeScript 类型守卫）
  throw lastError;
}

// ============================================================================
// 状态恢复
// ============================================================================

/**
 * 从数据库恢复 run 状态
 * 
 * Phase 5 P1: 用于跨进程恢复（例如服务重启后）
 */
export interface RecoverableRunState {
  runId: string;
  sessionId: string;
  userId: string;
  workspace: string;
  prompt: string;
  status: string;
  lastEventId?: string;
  startedAt: Date;
  contextFiles: string[];
}

/**
 * 检查 run 是否可恢复
 */
export function isRecoverable(state: RecoverableRunState): boolean {
  // 只恢复 RUNNING 或 WAITING_APPROVAL 状态的 run
  return state.status === "RUNNING" || state.status === "WAITING_APPROVAL";
}

/**
 * 恢复中断的 run（从数据库状态）
 * 
 * Phase 5 P1: 简化实现，仅标记为 FAILED
 * Phase 6: 实现真正的状态恢复（从 lastEventId 继续）
 */
export async function recoverRun(
  state: RecoverableRunState
): Promise<{ recovered: boolean; reason?: string }> {
  console.log(`[recoverRun] Checking runId=${state.runId}, status=${state.status}`);
  
  // 1. 检查是否可恢复
  if (!isRecoverable(state)) {
    return {
      recovered: false,
      reason: `Run status is ${state.status}, not recoverable`,
    };
  }
  
  // 2. 检查 run 是否超时（超过 1 小时）
  const elapsed = Date.now() - state.startedAt.getTime();
  const MAX_RUN_DURATION_MS = 60 * 60 * 1000; // 1 小时
  
  if (elapsed > MAX_RUN_DURATION_MS) {
    return {
      recovered: false,
      reason: `Run timeout (${Math.round(elapsed / 1000 / 60)} minutes)`,
    };
  }
  
  // 3. Phase 5 P1: 简化实现，标记为 FAILED
  // TODO Phase 6: 实现真正的状态恢复
  console.warn(
    `[recoverRun] Run recovery not yet implemented. ` +
    `Marking runId=${state.runId} as FAILED.`
  );
  
  return {
    recovered: false,
    reason: "Run recovery not yet implemented in Phase 5",
  };
}

// ============================================================================
// 降级策略
// ============================================================================

/**
 * 降级策略配置
 */
export interface FallbackConfig {
  /** 是否启用降级 */
  enabled: boolean;
  
  /** 降级策略类型 */
  strategy: "mock" | "retry" | "fail";
  
  /** 降级消息 */
  message?: string;
}

export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  enabled: true,
  strategy: "fail",
  message: "Pi SDK unavailable, please try again later",
};

/**
 * 执行降级策略
 */
export function executeFallback<T>(
  config: FallbackConfig,
  fallbackValue?: T
): T {
  if (!config.enabled) {
    throw new Error("Fallback disabled");
  }
  
  switch (config.strategy) {
    case "mock":
      if (fallbackValue === undefined) {
        throw new Error("Mock fallback requires fallbackValue");
      }
      console.warn("[executeFallback] Using mock fallback:", config.message);
      return fallbackValue;
    
    case "retry":
      throw new Error(config.message || "Retry required");
    
    case "fail":
    default:
      throw new Error(config.message || "Operation failed");
  }
}
