/**
 * Work Agent Runtime — Lifecycle
 *
 * Work Agent 的生命周期管理：
 * - 开始运行
 * - 结束运行（成功/失败/取消）
 * - 产物归档
 * - 状态桥接到 AgentRun 表
 */

import type { AgentRunStatus } from "@/features/ai/runtime/types";

// ============================================================================
// Lifecycle Events
// ============================================================================

export type LifecycleEvent =
  | { type: "started"; runId: string; userId: string; workflowType: string }
  | { type: "completed"; runId: string; summary?: string }
  | { type: "failed"; runId: string; error: string }
  | { type: "cancelled"; runId: string; reason?: string };

// ============================================================================
// Lifecycle Manager
// ============================================================================

export interface LifecycleCallbacks {
  onStart?: (event: LifecycleEvent & { type: "started" }) => Promise<void>;
  onComplete?: (event: LifecycleEvent & { type: "completed" }) => Promise<void>;
  onFail?: (event: LifecycleEvent & { type: "failed" }) => Promise<void>;
  onCancel?: (event: LifecycleEvent & { type: "cancelled" }) => Promise<void>;
}

export class LifecycleManager {
  private callbacks: LifecycleCallbacks;

  constructor(callbacks: LifecycleCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Emit run started event.
   */
  async started(runId: string, userId: string, workflowType: string): Promise<void> {
    const event: LifecycleEvent = {
      type: "started",
      runId,
      userId,
      workflowType,
    };
    await this.callbacks.onStart?.(event);
  }

  /**
   * Emit run completed event.
   */
  async completed(runId: string, summary?: string): Promise<void> {
    const event: LifecycleEvent = {
      type: "completed",
      runId,
      summary,
    };
    await this.callbacks.onComplete?.(event);
  }

  /**
   * Emit run failed event.
   */
  async failed(runId: string, error: string): Promise<void> {
    const event: LifecycleEvent = {
      type: "failed",
      runId,
      error,
    };
    await this.callbacks.onFail?.(event);
  }

  /**
   * Emit run cancelled event.
   */
  async cancelled(runId: string, reason?: string): Promise<void> {
    const event: LifecycleEvent = {
      type: "cancelled",
      runId,
      reason,
    };
    await this.callbacks.onCancel?.(event);
  }

  /**
   * Get final status from lifecycle event.
   */
  static toStatus(event: LifecycleEvent): AgentRunStatus {
    switch (event.type) {
      case "started":
        return "pending";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
    }
  }
}

// ============================================================================
// Prisma Integration (Stub)
// ============================================================================

/**
 * Create lifecycle manager that updates AgentRun table.
 * This is a stub - actual implementation needs Prisma integration.
 */
export function createAgentRunLifecycleManager(prisma: unknown) {
  return new LifecycleManager({
    async onStart(event) {
      // TODO: Update AgentRun status to "running"
      console.log(`[Lifecycle] Run ${event.runId} started for user ${event.userId}`);
    },
    async onComplete(event) {
      // TODO: Update AgentRun status to "completed" with summary
      console.log(`[Lifecycle] Run ${event.runId} completed: ${event.summary}`);
    },
    async onFail(event) {
      // TODO: Update AgentRun status to "failed" with error
      console.error(`[Lifecycle] Run ${event.runId} failed: ${event.error}`);
    },
    async onCancel(event) {
      // TODO: Update AgentRun status to "cancelled"
      console.warn(`[Lifecycle] Run ${event.runId} cancelled: ${event.reason}`);
    },
  });
}
