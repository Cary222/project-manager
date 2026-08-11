/**
 * Work Agent — Executor
 *
 * 职责：
 * - 执行 Planner 生成的 WorkStep[]
 * - 验证步骤
 * - 检查 Approval
 * - 调用 Tool
 * - 保存结果
 *
 * 第一版只做简单的顺序执行，不要复杂 DAG。
 */

import type { WorkStep } from "./planner";
import type { ExecutionContext } from "../router/route";

// ─── Executor Options ─────────────────────────────────────────────────────────

export interface ExecutorOptions {
  /** 步骤执行前是否检查 approval */
  checkApproval?: boolean;
  /** 最大并发步骤数（第一版固定为 1） */
  maxConcurrency?: number;
  /** 是否容许步骤失败继续执行 */
  continueOnError?: boolean;
}

// ─── Executor Events ──────────────────────────────────────────────────────────

export type ExecutorEvent =
  | { type: "step_start"; step: WorkStep }
  | { type: "step_complete"; step: WorkStep; result: unknown }
  | { type: "step_error"; step: WorkStep; error: string }
  | { type: "approval_required"; step: WorkStep }
  | { type: "approval_received"; approved: boolean; comment?: string };

export interface ExecutorCallbacks {
  onEvent?: (event: ExecutorEvent) => void;
  onApprovalRequired?: (step: WorkStep) => Promise<{ approved: boolean; comment?: string }>;
}

// ─── Executor ────────────────────────────────────────────────────────────────

export class Executor {
  private options: Required<ExecutorOptions>;
  private callbacks: ExecutorCallbacks;

  constructor(options: ExecutorOptions = {}, callbacks: ExecutorCallbacks = {}) {
    this.options = {
      checkApproval: options.checkApproval ?? true,
      maxConcurrency: options.maxConcurrency ?? 1,
      continueOnError: options.continueOnError ?? false,
    };
    this.callbacks = callbacks;
  }

  /**
   * 执行步骤数组。
   */
  async execute(
    steps: WorkStep[],
    _context: ExecutionContext
  ): Promise<{ success: boolean; results: WorkStep[] }> {
    const results: WorkStep[] = [];
    let hasError = false;

    for (const step of steps) {
      // Check approval if required
      if (this.options.checkApproval && step.action !== "execute") {
        const approvalResult = await this.requestApproval(step);
        if (!approvalResult.approved) {
          step.status = "skipped";
          step.error = "User rejected";
          results.push(step);
          continue;
        }
      }

      // Execute step
      try {
        this.emit({ type: "step_start", step });

        step.status = "running";
        const result = await this.executeStep(step);

        step.status = "done";
        step.result = result;

        this.emit({ type: "step_complete", step, result });

      } catch (error) {
        step.status = "failed";
        step.error = error instanceof Error ? error.message : String(error);

        this.emit({ type: "step_error", step, error: step.error });

        if (!this.options.continueOnError) {
          hasError = true;
          break;
        }
      }

      results.push(step);
    }

    return { success: !hasError, results };
  }

  /**
   * 执行单个步骤。
   */
  private async executeStep(step: WorkStep): Promise<unknown> {
    // TODO: 根据 step.tool 调用对应的工具
    // For now, return a placeholder
    void step;

    return { message: "Step executed", timestamp: new Date().toISOString() };
  }

  /**
   * 请求审批。
   */
  private async requestApproval(step: WorkStep): Promise<{ approved: boolean; comment?: string }> {
    this.emit({ type: "approval_required", step });

    if (this.callbacks.onApprovalRequired) {
      return await this.callbacks.onApprovalRequired(step);
    }

    // Default: auto-approve for now
    return { approved: true };
  }

  /**
   * 发送事件。
   */
  private emit(event: ExecutorEvent): void {
    this.callbacks.onEvent?.(event);
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createExecutor(
  options?: ExecutorOptions,
  callbacks?: ExecutorCallbacks
): Executor {
  return new Executor(options, callbacks);
}
