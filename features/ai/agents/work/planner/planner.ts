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
import { callAgnes } from "@/features/ai/llm/summarizer";
import { toolCatalogPrompt, validateSteps } from "./validate";

// ─── WorkStep ────────────────────────────────────────────────────────────────

export interface WorkStep {
  id: string;
  action: string;
  description: string;
  tool?: string;
  /** 经 critic 校验过的工具入参。执行期直接透传给工具。 */
  args?: Record<string, unknown>;
  dependsOn: string[];
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: unknown;
  error?: string;
}

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface Plan {
  goal: Goal;
  title?: string;
  steps: WorkStep[];
  requiresApproval: boolean;
  estimatedSteps: number;
}

// ─── Planner Interface ───────────────────────────────────────────────────────

export interface Planner {
  plan(goal: Goal, context?: Record<string, unknown>): Promise<Plan>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_PLAN_STEPS = 8;

// 工具清单从 critic 的工具目录生成 —— 绝不在这里手写。
// 历史教训：这里曾写着 searchStructured/generateText，而它们根本不存在，
// 于是 LLM 稳定产出幻觉工具名，执行期静默失败。
// 用 toolCatalogPrompt() 保证 prompt 与白名单永远同源。

// ─── Default LLM Planner ─────────────────────────────────────────────────────

export class LLPlanner implements Planner {
  async plan(goal: Goal, context?: Record<string, unknown>): Promise<Plan> {
    try {
      return await this.planWithLLM(goal, context);
    } catch {
      // 任何异常退回单步降级
      return this.fallbackSingleStep(goal);
    }
  }

  /**
   * LLM 驱动的多步拆解。
   */
  private async planWithLLM(goal: Goal, context?: Record<string, unknown>): Promise<Plan> {
    const userId = (context?.userId as string) || undefined;

    const res = await callAgnes(
      [
        {
          role: "system",
          content: `你是一个任务拆解器。将用户目标拆解为 1~${MAX_PLAN_STEPS} 个有序步骤。
可用工具：
${toolCatalogPrompt()}

约束：
- 结合需求提炼 6~16 个字的任务精炼标题（如“延期工单归因分析复盘”），填入 title 字段
- 步骤数 1~${MAX_PLAN_STEPS}
- dependsOn 只能引用已出现的 id，无依赖时为空数组
- tool 只能从可用工具中选择，或为 null

直接输出 JSON（不要 markdown 代码块）：
{"title": "任务精炼标题", "steps": [{"id": "s1", "action": "动作名", "description": "描述", "tool": "工具名或null", "dependsOn": []}]}`,
        },
        { role: "user", content: goal.description },
      ],
      { userId },
    );

    // 清洗 + 解析
    const cleaned = res.content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as {
      title?: string;
      steps?: Array<{
        id?: string;
        action?: string;
        description?: string;
        tool?: string | null;
        dependsOn?: string[];
      }>;
    };

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return this.fallbackSingleStep(goal);
    }

    // 交给 critic 严格校验：工具白名单、参数 schema、id 唯一、dependsOn 无悬空无环。
    // 校验不过就退回单步降级，而不是把一个"看起来能跑"的坏计划放行 ——
    // 幻觉工具名必须在这里被拦下，不能流到执行期变成静默 no-op。
    const validation = validateSteps(parsed.steps);
    if (!validation.ok) {
      return this.fallbackSingleStep(goal);
    }

    const steps: WorkStep[] = validation.steps.map((s) => ({
      id: s.id,
      action: s.action,
      description: s.description,
      tool: s.tool,
      args: s.args,
      dependsOn: s.dependsOn,
      status: "pending" as const,
    }));

    // 环检测 — 有环则退回单步
    if (hasCycle(steps)) {
      return this.fallbackSingleStep(goal);
    }

    // 拓扑排序
    const sorted = topologicalSort(steps);

    const isMultiStep = sorted.length > 1;
    const title = parsed.title?.trim() || goal.description.slice(0, 20);
    return {
      goal,
      title,
      steps: sorted,
      requiresApproval: isMultiStep,
      estimatedSteps: sorted.length,
    };
  }

  /**
   * 降级：单步「文本分析」计划。
   *
   * 降级路径**不做任何关键词业务路由** —— 关键词既判不准业务意图，
   * 又会在这里重新引入幻觉工具名（曾经返回 searchStructured/generateText）。
   * 只产出一个必定合法的、无副作用的 generate_text 步骤：
   * 目标原样交给它，产出文本而不是伪造的查询结果。
   * 信息不足由 Decision 层的 clarify 负责，不在这里猜。
   */
  private fallbackSingleStep(goal: Goal): Plan {
    const step: WorkStep = {
      id: "execute",
      action: "analyze",
      description: goal.description,
      tool: "generate_text",
      args: { instruction: goal.description },
      dependsOn: [],
      status: "pending",
    };

    return {
      goal,
      title: goal.description.slice(0, 20),
      steps: [step],
      requiresApproval: false,
      estimatedSteps: 1,
    };
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

/**
 * 拓扑排序（DFS）。调用前应先用 hasCycle() 确认无环。
 */
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

/**
 * 三色标记环检测。
 * white=未访问, gray=栈中（正在访问其后继）, black=已完成。
 * 遇到 gray 节点说明有回边 → 有环。
 */
export function hasCycle(steps: WorkStep[]): boolean {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const white = new Set(steps.map((s) => s.id));
  const gray = new Set<string>();

  function dfs(id: string): boolean {
    white.delete(id);
    gray.add(id);

    const step = stepMap.get(id);
    if (step) {
      for (const depId of step.dependsOn) {
        if (gray.has(depId)) return true;       // 回边 → 环
        if (white.has(depId) && dfs(depId)) return true;
      }
    }

    gray.delete(id);
    return false;
  }

  for (const id of [...white]) {
    if (white.has(id) && dfs(id)) return true;
  }
  return false;
}
