/**
 * Phase 5 P1: 并发控制
 * 
 * 功能：
 * 1. 全局并发限制：同时运行的 SubAgent 数量上限
 * 2. 用户并发限制：每个用户的并发上限
 * 3. 队列管理：超出限制后的排队机制
 * 4. 资源监控：内存 / CPU 使用率监控
 */

// ============================================================================
// 并发限制配置
// ============================================================================

export interface ConcurrencyConfig {
  /** 全局最大并发数 */
  globalMaxConcurrent: number;
  
  /** 每用户最大并发数 */
  perUserMaxConcurrent: number;
  
  /** 是否启用队列 */
  enableQueue: boolean;
  
  /** 队列最大长度 */
  maxQueueSize: number;
  
  /** 队列超时时间（毫秒） */
  queueTimeoutMs: number;
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  globalMaxConcurrent: 10,
  perUserMaxConcurrent: 3,
  enableQueue: true,
  maxQueueSize: 50,
  queueTimeoutMs: 5 * 60 * 1000, // 5 分钟
};

// ============================================================================
// 并发控制器
// ============================================================================

interface QueuedRun {
  runId: string;
  userId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

export class ConcurrencyController {
  private config: ConcurrencyConfig;
  private runningCount = 0;
  private runningByUser = new Map<string, number>();
  private queue: QueuedRun[] = [];
  private runningRuns = new Set<string>();
  
  constructor(config: Partial<ConcurrencyConfig> = {}) {
    this.config = { ...DEFAULT_CONCURRENCY_CONFIG, ...config };
  }
  
  /**
   * 获取当前统计信息
   */
  getStats() {
    return {
      runningCount: this.runningCount,
      queueSize: this.queue.length,
      runningByUser: Object.fromEntries(this.runningByUser.entries()),
    };
  }
  
  /**
   * 尝试获取执行许可
   * 
   * @returns Promise<void> 获得许可后 resolve
   * @throws 队列满或超时时抛出错误
   */
  async acquire(runId: string, userId: string): Promise<void> {
    // 1. 检查是否可以立即执行
    if (this.canExecuteNow(userId)) {
      this.incrementCounters(runId, userId);
      return;
    }
    
    // 2. 检查是否启用队列
    if (!this.config.enableQueue) {
      throw new Error(
        `Concurrency limit reached. ` +
        `Global: ${this.runningCount}/${this.config.globalMaxConcurrent}, ` +
        `User: ${this.runningByUser.get(userId) || 0}/${this.config.perUserMaxConcurrent}`
      );
    }
    
    // 3. 检查队列是否已满
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(
        `Queue full (${this.queue.length}/${this.config.maxQueueSize}). ` +
        `Please try again later.`
      );
    }
    
    // 4. 加入队列
    console.log(
      `[ConcurrencyController] Queuing runId=${runId} (queue size: ${this.queue.length + 1})`
    );
    
    return new Promise<void>((resolve, reject) => {
      const queuedRun: QueuedRun = {
        runId,
        userId,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };
      
      this.queue.push(queuedRun);
      
      // 设置超时
      const timeout = setTimeout(() => {
        this.removeFromQueue(runId);
        reject(new Error(`Queue timeout (${this.config.queueTimeoutMs}ms)`));
      }, this.config.queueTimeoutMs);
      
      // 清理超时（当 resolve/reject 时）
      const originalResolve = resolve;
      const wrappedResolve = () => {
        clearTimeout(timeout);
        this.incrementCounters(runId, userId);
        originalResolve();
      };
      
      queuedRun.resolve = wrappedResolve;
    });
  }
  
  /**
   * 释放执行许可
   */
  release(runId: string, userId: string): void {
    if (!this.runningRuns.has(runId)) {
      console.warn(`[ConcurrencyController] runId=${runId} not found in running set`);
      return;
    }
    
    this.decrementCounters(runId, userId);
    
    // 检查队列，尝试执行下一个
    this.processQueue();
  }
  
  /**
   * 检查是否可以立即执行
   */
  private canExecuteNow(userId: string): boolean {
    // 1. 检查全局并发限制
    if (this.runningCount >= this.config.globalMaxConcurrent) {
      return false;
    }
    
    // 2. 检查用户并发限制
    const userCount = this.runningByUser.get(userId) || 0;
    if (userCount >= this.config.perUserMaxConcurrent) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 增加计数器
   */
  private incrementCounters(runId: string, userId: string): void {
    this.runningCount++;
    this.runningRuns.add(runId);
    
    const userCount = this.runningByUser.get(userId) || 0;
    this.runningByUser.set(userId, userCount + 1);
    
    console.log(
      `[ConcurrencyController] Acquired: runId=${runId}, ` +
      `global=${this.runningCount}/${this.config.globalMaxConcurrent}, ` +
      `user(${userId})=${userCount + 1}/${this.config.perUserMaxConcurrent}`
    );
  }
  
  /**
   * 减少计数器
   */
  private decrementCounters(runId: string, userId: string): void {
    this.runningCount--;
    this.runningRuns.delete(runId);
    
    const userCount = this.runningByUser.get(userId) || 0;
    if (userCount <= 1) {
      this.runningByUser.delete(userId);
    } else {
      this.runningByUser.set(userId, userCount - 1);
    }
    
    console.log(
      `[ConcurrencyController] Released: runId=${runId}, ` +
      `global=${this.runningCount}/${this.config.globalMaxConcurrent}, ` +
      `user(${userId})=${Math.max(0, userCount - 1)}/${this.config.perUserMaxConcurrent}`
    );
  }
  
  /**
   * 从队列中移除
   */
  private removeFromQueue(runId: string): void {
    const index = this.queue.findIndex((q) => q.runId === runId);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }
  
  /**
   * 处理队列，尝试执行下一个
   */
  private processQueue(): void {
    if (this.queue.length === 0) {
      return;
    }
    
    // 遍历队列，找到第一个可以执行的 run
    for (let i = 0; i < this.queue.length; i++) {
      const queuedRun = this.queue[i];
      
      // 检查是否超时
      const elapsed = Date.now() - queuedRun.enqueuedAt;
      if (elapsed > this.config.queueTimeoutMs) {
        console.warn(
          `[ConcurrencyController] Queue timeout for runId=${queuedRun.runId}`
        );
        this.queue.splice(i, 1);
        queuedRun.reject(
          new Error(`Queue timeout (${Math.round(elapsed / 1000)}s)`)
        );
        i--;
        continue;
      }
      
      // 检查是否可以执行
      if (this.canExecuteNow(queuedRun.userId)) {
        this.queue.splice(i, 1);
        console.log(
          `[ConcurrencyController] Dequeued runId=${queuedRun.runId} ` +
          `(waited ${Math.round(elapsed / 1000)}s)`
        );
        queuedRun.resolve();
        break;
      }
    }
  }
}

// 全局单例
let globalController: ConcurrencyController | null = null;

/**
 * 获取全局并发控制器
 */
export function getConcurrencyController(): ConcurrencyController {
  if (!globalController) {
    globalController = new ConcurrencyController();
  }
  return globalController;
}

/**
 * 重置全局并发控制器（测试用）
 */
export function resetConcurrencyController(
  config?: Partial<ConcurrencyConfig>
): void {
  globalController = new ConcurrencyController(config);
}
