/**
 * Phase 5 P2: 监控与日志
 * 
 * 功能：
 * 1. 结构化日志：统一日志格式 + 分级
 * 2. 性能指标：执行时间 / 成功率 / 错误率
 * 3. 资源监控：内存 / CPU / 并发数
 * 4. 告警机制：异常情况告警
 */
import { totalmem } from "node:os";

// ============================================================================
// 日志级别
// ============================================================================

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  FATAL = "fatal",
}

// ============================================================================
// 结构化日志
// ============================================================================

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  runId?: string;
  userId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class StructuredLogger {
  private component: string;
  private minLevel: LogLevel;
  
  constructor(component: string, minLevel: LogLevel = LogLevel.INFO) {
    this.component = component;
    this.minLevel = minLevel;
  }
  
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }
  
  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      metadata,
    };
    
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    
    // 输出到控制台（生产环境应该写入日志文件）
    const output = JSON.stringify(entry);
    
    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(output);
        break;
    }
  }
  
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }
  
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, metadata);
  }
  
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, metadata);
  }
  
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, metadata, error);
  }
  
  fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.FATAL, message, metadata, error);
  }
}

// ============================================================================
// 性能指标
// ============================================================================

export interface PerformanceMetrics {
  /** 总执行次数 */
  totalRuns: number;
  
  /** 成功次数 */
  successCount: number;
  
  /** 失败次数 */
  failureCount: number;
  
  /** 取消次数 */
  cancelledCount: number;
  
  /** 平均执行时间（毫秒） */
  avgDurationMs: number;
  
  /** 最小执行时间（毫秒） */
  minDurationMs: number;
  
  /** 最大执行时间（毫秒） */
  maxDurationMs: number;
  
  /** P50 延迟（毫秒） */
  p50DurationMs: number;
  
  /** P95 延迟（毫秒） */
  p95DurationMs: number;
  
  /** P99 延迟（毫秒） */
  p99DurationMs: number;
}

interface MetricEntry {
  status: "completed" | "failed" | "cancelled";
  durationMs: number;
  timestamp: number;
}

export class MetricsCollector {
  private entries: MetricEntry[] = [];
  private maxEntries = 1000; // 保留最近 1000 条记录
  
  /**
   * 记录一次执行
   */
  record(status: "completed" | "failed" | "cancelled", durationMs: number): void {
    this.entries.push({
      status,
      durationMs,
      timestamp: Date.now(),
    });
    
    // 限制内存使用
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }
  
  /**
   * 获取性能指标
   */
  getMetrics(): PerformanceMetrics {
    if (this.entries.length === 0) {
      return {
        totalRuns: 0,
        successCount: 0,
        failureCount: 0,
        cancelledCount: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
      };
    }
    
    const successCount = this.entries.filter(e => e.status === "completed").length;
    const failureCount = this.entries.filter(e => e.status === "failed").length;
    const cancelledCount = this.entries.filter(e => e.status === "cancelled").length;
    
    const durations = this.entries.map(e => e.durationMs).sort((a, b) => a - b);
    const sum = durations.reduce((acc, d) => acc + d, 0);
    
    return {
      totalRuns: this.entries.length,
      successCount,
      failureCount,
      cancelledCount,
      avgDurationMs: Math.round(sum / durations.length),
      minDurationMs: durations[0],
      maxDurationMs: durations[durations.length - 1],
      p50DurationMs: this.percentile(durations, 0.5),
      p95DurationMs: this.percentile(durations, 0.95),
      p99DurationMs: this.percentile(durations, 0.99),
    };
  }
  
  /**
   * 计算百分位数
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }
  
  /**
   * 重置指标
   */
  reset(): void {
    this.entries = [];
  }
}

// 全局单例
let globalMetrics: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!globalMetrics) {
    globalMetrics = new MetricsCollector();
  }
  return globalMetrics;
}

// ============================================================================
// 资源监控
// ============================================================================

export interface ResourceMetrics {
  /** 内存使用（MB） */
  memoryUsageMB: number;
  
  /** 内存使用百分比 */
  memoryUsagePercent: number;
  
  /** CPU 使用百分比（估算） */
  cpuUsagePercent: number;
  
  /** 当前并发数 */
  concurrentRuns: number;
}

export function getResourceMetrics(): ResourceMetrics {
  const memUsage = process.memoryUsage();
  const totalMemoryMB = totalmem() / 1024 / 1024;
  const usedMemoryMB = memUsage.heapUsed / 1024 / 1024;
  
  return {
    memoryUsageMB: Math.round(usedMemoryMB),
    memoryUsagePercent: Math.round((usedMemoryMB / totalMemoryMB) * 100),
    cpuUsagePercent: 0, // 简化实现，不统计 CPU
    concurrentRuns: 0, // 由 ConcurrencyController 提供
  };
}
