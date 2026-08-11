/**
 * Work Agent — Route Executor
 *
 * 职责：
 * - 接收 Router 的决策
 * - 执行 workflow 或 planner
 * - 管理执行生命周期
 */

import type { RouterResult, ExecutionStrategy } from "./router";
import type { WorkflowTemplate } from "../workflows/registry";
import type { Planner } from "../planner/planner";
import type { Goal } from "@/features/ai/runtime/types";

// ─── Execution Context ────────────────────────────────────────────────────────

export interface ExecutionContext {
  runId: string;
  userId: string;
  threadId?: string;
  checkpointNamespace?: string;
}

// ─── Execution Result ────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  strategy: ExecutionStrategy;
  output?: unknown;
  error?: string;
}

// ─── Route Executor ──────────────────────────────────────────────────────────

export class RouteExecutor {
  private workflowRegistry: Map<string, WorkflowTemplate>;
  private planner: Planner;

  constructor(workflowRegistry: Map<string, WorkflowTemplate>, planner: Planner) {
    this.workflowRegistry = workflowRegistry;
    this.planner = planner;
  }

  /**
   * 根据 Router 结果执行对应的策略。
   */
  async execute(
    routerResult: RouterResult,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { strategy } = routerResult;

    try {
      switch (strategy.mode) {
        case "workflow":
          return await this.executeWorkflow(strategy, context);

        case "planning":
          return await this.executePlanning(strategy, context);

        default:
          return {
            success: false,
            strategy,
            error: `Unknown strategy mode: ${(strategy as unknown as { mode: string }).mode}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        strategy,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 执行确定性工作流。
   */
  private async executeWorkflow(
    strategy: Extract<ExecutionStrategy, { mode: "workflow" }>,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const template = this.workflowRegistry.get(strategy.workflowId);

    if (!template) {
      return {
        success: false,
        strategy,
        error: `Workflow not found: ${strategy.workflowId}`,
      };
    }

    console.log(`[RouteExecutor] Executing workflow: ${strategy.workflowId}`);

    // TODO: 调用 workflow graph
    // await template.invoke({
    //   ...strategy.params,
    //   runId: context.runId,
    //   threadId: context.threadId,
    // });

    return {
      success: true,
      strategy,
      output: { workflowType: strategy.workflowId, params: strategy.params },
    };
  }

  /**
   * 执行动态规划（autonomous fallback）。
   */
  private async executePlanning(
    strategy: Extract<ExecutionStrategy, { mode: "planning" }>,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    console.log(`[RouteExecutor] Executing planning for goal: ${strategy.goal}`);

    const goal: Goal = {
      id: context.runId,
      type: "custom",
      description: strategy.goal,
      createdAt: new Date().toISOString(),
    };

    const plan = await this.planner.plan(goal, strategy.context);

    console.log(`[RouteExecutor] Generated ${plan.steps.length} steps`);

    // TODO: 调用 dynamic executor 执行 plan.steps
    // const executor = createDynamicExecutor(...);
    // await executor.execute(plan.steps, context);

    return {
      success: true,
      strategy,
      output: { plan, stepsCount: plan.steps.length },
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRouteExecutor(
  workflowRegistry: Map<string, WorkflowTemplate>,
  planner: Planner
): RouteExecutor {
  return new RouteExecutor(workflowRegistry, planner);
}
