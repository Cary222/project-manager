/**
 * Dynamic Executor — 动态路径执行器
 *
 * 按 WorkStep[] 动态执行，支持循环、HIL 和 MAX_STEPS 防死循环。
 * 这是 Runtime Primitive，不是 Workflow 业务逻辑。
 */

import type { RuntimeEventEmitter } from "../events";
import type { Plan, PlanStep } from "../types";

// ============================================================================
// Execution Options
// ============================================================================

export interface ExecutorOptions {
  maxSteps?: number;         // 默认 20，防止死循环
  onStepStart?: (step: PlanStep) => void;
  onStepEnd?: (step: PlanStep, result: unknown) => void;
  onApproval?: (step: PlanStep, context: Record<string, unknown>) => void;
  onError?: (step: PlanStep, error: Error) => void;
}

// ============================================================================
// Execution Result
// ============================================================================

export type StepResult =
  | { type: "done"; value: unknown }
  | { type: "approval"; step: PlanStep; context: Record<string, unknown> }
  | { type: "error"; step: PlanStep; error: Error };

// ============================================================================
// Dynamic Executor
// ============================================================================

export class DynamicExecutor {
  private maxSteps: number;
  private options: ExecutorOptions;
  private eventEmitter?: RuntimeEventEmitter;

  constructor(options: ExecutorOptions = {}) {
    this.maxSteps = options.maxSteps ?? 20;
    this.options = options;
  }

  setEventEmitter(emitter: RuntimeEventEmitter): void {
    this.eventEmitter = emitter;
  }

  /**
   * Execute a plan dynamically.
   * @param steps - Plan steps to execute
   * @param executeStep - Step executor function
   * @param resumeApproval - Approval resume handler (called after human approval)
   * @returns Final state
   */
  async execute(
    steps: PlanStep[],
    executeStep: (step: PlanStep, ctx: ExecutionContext) => Promise<StepResult>,
    resumeApproval?: (decision: ApprovalDecision, feedback?: string) => Promise<void>,
  ): Promise<{ done: boolean; lastResult?: StepResult; stepsExecuted: number }> {
    const ctx: ExecutionContext = {
      currentStepIndex: 0,
      executedSteps: [],
      startTime: Date.now(),
    };

    for (let i = 0; i < this.maxSteps; i++) {
      // Check if all steps are done
      const remaining = steps.filter((s) => !ctx.executedSteps.includes(s.id));
      if (remaining.length === 0) {
        return { done: true, stepsExecuted: i };
      }

      // Find next step whose dependencies are satisfied
      const nextStep = this.findNextStep(remaining, ctx.executedSteps);
      if (!nextStep) {
        // Dead end - no step can proceed
        return { done: false, lastResult: undefined, stepsExecuted: i };
      }

      ctx.currentStepIndex = i;
      this.options.onStepStart?.(nextStep);

      try {
        const result = await executeStep(nextStep, ctx);

        ctx.executedSteps.push(nextStep.id);
        this.options.onStepEnd?.(nextStep, result);

        if (result.type === "approval") {
          this.options.onApproval?.(nextStep, result.context);
          // Wait for human approval to resume
          // The caller should handle the approval and call resumeApproval
          return {
            done: false,
            lastResult: result,
            stepsExecuted: i + 1,
          };
        }

        if (result.type === "error") {
          this.options.onError?.(nextStep, result.error);
          return {
            done: false,
            lastResult: result,
            stepsExecuted: i + 1,
          };
        }

        // Continue to next step
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.options.onError?.(nextStep, err);
        return {
          done: false,
          lastResult: { type: "error", step: nextStep, error: err } as StepResult,
          stepsExecuted: i + 1,
        };
      }
    }

    // MAX_STEPS exceeded
    return {
      done: false,
      lastResult: {
        type: "error",
        step: steps[steps.length - 1],
        error: new Error(`Max steps (${this.maxSteps}) exceeded`),
      } as StepResult,
      stepsExecuted: this.maxSteps,
    };
  }

  /**
   * Find the next step whose dependencies are all satisfied.
   */
  private findNextStep(steps: PlanStep[], executed: string[]): PlanStep | undefined {
    return steps.find((step) =>
      step.dependsOn.every((dep) => executed.includes(dep))
    );
  }
}

// ============================================================================
// Execution Context
// ============================================================================

export interface ExecutionContext {
  currentStepIndex: number;
  executedSteps: string[];
  startTime: number;
}

// ============================================================================
// Approval Decision
// ============================================================================

export type ApprovalDecision = "approve" | "revise" | "reject";

// ============================================================================
// Factory
// ============================================================================

export function createDynamicExecutor(options?: ExecutorOptions): DynamicExecutor {
  return new DynamicExecutor(options);
}
