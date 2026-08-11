/**
 * Work Agent — Planner
 *
 * 职责：
 * - 当 Router 命中 template 时，不需要 planner
 * - 当 Router miss 时（autonomous fallback），使用 planner 将 goal 拆解为 WorkStep[]
 *
 * 第一版只做简单 LLM 拆解，不要复杂 DAG / reflection / self-correction
 *
 * 例子输出：
 * [
 *   { id: "step1", action: "search_ticket", tool: "searchStructured" },
 *   { id: "step2", action: "generate_report", tool: "write" }
 * ]
 */

import type { Goal } from "@/features/ai/runtime/types";

// ─── WorkStep ────────────────────────────────────────────────────────────────

export interface WorkStep {
  id: string;
  action: string;
  description: string;
  tool?: string;
  dependsOn: string[];
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: unknown;
  error?: string;
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface Plan {
  goal: Goal;
  steps: WorkStep[];
  requiresApproval: boolean;
  estimatedSteps: number;
}

// ─── Planner Interface ───────────────────────────────────────────────────────

export interface Planner {
  plan(goal: Goal, context?: Record<string, unknown>): Promise<Plan>;
}

// ─── Default LLM Planner ─────────────────────────────────────────────────────

export class LLPlanner implements Planner {
  async plan(goal: Goal, context?: Record<string, unknown>): Promise<Plan> {
    // TODO: Call LLM to decompose goal into steps
    // For now, return a simple single-step plan
    void context;

    const step: WorkStep = {
      id: "execute",
      action: goal.type,
      description: goal.description,
      tool: this.inferTool(goal),
      dependsOn: [],
      status: "pending",
    };

    return {
      goal,
      steps: [step],
      requiresApproval: false,
      estimatedSteps: 1,
    };
  }

  private inferTool(goal: Goal): string | undefined {
    const desc = goal.description.toLowerCase();
    if (desc.includes("查") || desc.includes("获取") || desc.includes("拉取")) {
      return "searchStructured";
    }
    if (desc.includes("生成") || desc.includes("写")) {
      return "generateText";
    }
    return undefined;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPlanner(): Planner {
  return new LLPlanner();
}

// ─── Step Utilities ──────────────────────────────────────────────────────────

export function createStep(
  id: string,
  action: string,
  description: string,
  options?: Partial<WorkStep>
): WorkStep {
  return {
    id,
    action,
    description,
    dependsOn: [],
    status: "pending",
    ...options,
  };
}

export function topologicalSort(steps: WorkStep[]): WorkStep[] {
  const visited = new Set<string>();
  const result: WorkStep[] = [];

  function visit(step: WorkStep) {
    if (visited.has(step.id)) return;
    visited.add(step.id);
    for (const depId of step.dependsOn) {
      const dep = steps.find((s) => s.id === depId);
      if (dep) visit(dep);
    }
    result.push(step);
  }

  for (const step of steps) {
    visit(step);
  }

  return result;
}
