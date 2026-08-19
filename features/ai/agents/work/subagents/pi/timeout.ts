/**
 * Phase 5 P2: 超时管理
 * 
 * 功能：
 * 1. SubAgent 执行超时：最大运行时间限制
 * 2. HIL 审批超时：用户审批最大等待时间
 * 3. 超时处理：自动取消 + 清理资源
 * 4. 超时告警：记录超时事件
 */

// ============================================================================
// 超时配置
// ============================================================================

export interface TimeoutConfig {
  /** SubAgent 执行超时（毫秒） */
  executionTimeoutMs: number;
  
  /** HIL 审批超时（毫秒） */
  approvalTimeoutMs: number;
  
  /** 是否启用超时 */
  enabled: boolean;
  
  /** 超时后的操作 */
  action: "cancel" | "warn";
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  executionTimeoutMs: 30 * 60 * 1000, // 30 分钟
  approvalTimeoutMs: 10 * 60 * 1000,  // 10 分钟
  enabled: true,
  action: "cancel",
};

// ============================================================================
// 超时管理器
// ============================================================================

export class TimeoutManager {
  private config: TimeoutConfig;
  private timers = new Map<string, NodeJS.Timeout>();
  private startTimes = new Map<string, number>();
  
  constructor(config: Partial<TimeoutConfig> = {}) {
    this.config = { ...DEFAULT_TIMEOUT_CONFIG, ...config };
  }
  
  /**
   * 启动执行超时计时器
   */
  startExecutionTimeout(
    runId: string,
    onTimeout: () => void
  ): void {
    if (!this.config.enabled) {
      return;
    }
    
    this.startTimes.set(runId, Date.now());
    
    const timer = setTimeout(() => {
      console.warn(
        `[TimeoutManager] Execution timeout for runId=${runId} ` +
        `(${this.config.executionTimeoutMs}ms)`
      );
      
      this.timers.delete(runId);
      this.startTimes.delete(runId);
      
      if (this.config.action === "cancel") {
        onTimeout();
      }
    }, this.config.executionTimeoutMs);
    
    this.timers.set(runId, timer);
  }
  
  /**
   * 启动审批超时计时器
   */
  startApprovalTimeout(
    runId: string,
    callId: string,
    onTimeout: () => void
  ): void {
    if (!this.config.enabled) {
      return;
    }
    
    const timeoutId = `${runId}:${callId}`;
    this.startTimes.set(timeoutId, Date.now());
    
    const timer = setTimeout(() => {
      console.warn(
        `[TimeoutManager] Approval timeout for runId=${runId}, callId=${callId} ` +
        `(${this.config.approvalTimeoutMs}ms)`
      );
      
      this.timers.delete(timeoutId);
      this.startTimes.delete(timeoutId);
      
      if (this.config.action === "cancel") {
        onTimeout();
      }
    }, this.config.approvalTimeoutMs);
    
    this.timers.set(timeoutId, timer);
  }
  
  /**
   * 清除超时计时器
   */
  clearTimeout(runId: string, callId?: string): void {
    const timeoutId = callId ? `${runId}:${callId}` : runId;
    
    const timer = this.timers.get(timeoutId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(timeoutId);
    }
    
    this.startTimes.delete(timeoutId);
  }
  
  /**
   * 获取已运行时间（毫秒）
   */
  getElapsedTime(runId: string, callId?: string): number | null {
    const timeoutId = callId ? `${runId}:${callId}` : runId;
    const startTime = this.startTimes.get(timeoutId);
    
    if (!startTime) {
      return null;
    }
    
    return Date.now() - startTime;
  }
  
  /**
   * 检查是否超时
   */
  isTimeout(runId: string, callId?: string): boolean {
    const elapsed = this.getElapsedTime(runId, callId);
    if (elapsed === null) {
      return false;
    }
    
    const timeoutMs = callId 
      ? this.config.approvalTimeoutMs 
      : this.config.executionTimeoutMs;
    
    return elapsed > timeoutMs;
  }
  
  /**
   * 清理所有计时器
   */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    
    this.timers.clear();
    this.startTimes.clear();
  }
}

// 全局单例
let globalTimeoutManager: TimeoutManager | null = null;

export function getTimeoutManager(): TimeoutManager {
  if (!globalTimeoutManager) {
    globalTimeoutManager = new TimeoutManager();
  }
  return globalTimeoutManager;
}

export function resetTimeoutManager(config?: Partial<TimeoutConfig>): void {
  if (globalTimeoutManager) {
    globalTimeoutManager.clearAll();
  }
  globalTimeoutManager = new TimeoutManager(config);
}
