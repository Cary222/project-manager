/**
 * PlanStep Critic — 计划步骤的唯一校验关口（C3）。
 *
 * 为什么需要它：planner 的 prompt 一度宣传 `searchStructured`/`generateText`，
 * 而真实注册的工具是 `read_resource`/`write_file`/`edit_file`/`execute_command`。
 * LLM 会自信地产出幻觉工具名，执行期要么 404 要么静默 no-op，
 * 用户看到"计划已批准"却什么都没发生。
 *
 * 本模块是 planner 输出 → executor 之间的强制契约：
 * - 工具必须在白名单里，未知工具 = 硬错误，绝不静默丢弃或"猜一个最像的"
 * - 参数必须过 zod schema
 * - stepId 唯一、dependsOn 不悬空、无环
 * - 步骤数上限
 * - 有副作用的工具自动标记 requiresActionApproval（计划批准不授权它）
 *
 * 校验失败必须把 errors 原文回给 LLM 做有界重规划，或回给人看。
 */

import { z } from "zod";
import type { ValidatedStep } from "../runtime/work-run-store";
import { hasCycle } from "./planner";
import {
  CAPABILITY_CATALOG,
  getCapability,
  capabilityCatalogPrompt,
  type CapabilitySpec,
  type ToolKind,
} from "@/features/ai/core/capability-registry";

// ============================================================================
// 兼容层 — 旧 API 代理到 Shared Capability Registry
// ============================================================================

/** @deprecated 使用 CapabilitySpec。向后兼容旧类型引用。 */
export type ToolSpec = CapabilitySpec;
export type { ToolKind };

/** @deprecated 使用 CAPABILITY_CATALOG。保留导出名以兼容现有 import。 */
export const WORK_TOOL_CATALOG: CapabilitySpec[] = CAPABILITY_CATALOG;

const TOOL_MAP = new Map(CAPABILITY_CATALOG.map((t) => [t.name, t]));

export function getToolSpec(name: string): CapabilitySpec | undefined {
  return getCapability(name);
}

/** 给 planner prompt 用的工具清单 — 代理到共享 registry。 */
export function toolCatalogPrompt(): string {
  return capabilityCatalogPrompt("WORK");
}

// ============================================================================
// 校验
// ============================================================================

export const MAX_PLAN_STEPS = 8;
export const MAX_REPLAN_ROUNDS = 3;

/** LLM 原始产出，字段全部可选 —— critic 负责把它变成可信结构。 */
export interface RawStep {
  id?: unknown;
  action?: unknown;
  description?: unknown;
  tool?: unknown;
  args?: unknown;
  dependsOn?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  steps: ValidatedStep[];
  /** 人类可读的错误列表；重规划时原文回喂 LLM。 */
  errors: string[];
  /** 被自动修正的问题（可接受，但要留痕）。 */
  warnings: string[];
}

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/;

/**
 * 严格校验 LLM 产出的步骤数组。
 *
 * 策略：宁可整体失败并回喂错误，也不要产出一个"看起来能跑"的半残计划。
 * 唯一的宽容是 dependsOn 里指向不存在 id 的项会被剔除并记 warning
 * （LLM 常见的无害笔误），其余一律硬错误。
 */
export function validateSteps(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      steps: [],
      errors: ["steps 必须是数组"],
      warnings: [],
    };
  }
  if (raw.length === 0) {
    return { ok: false, steps: [], errors: ["steps 不能为空"], warnings: [] };
  }
  if (raw.length > MAX_PLAN_STEPS) {
    errors.push(`步骤数 ${raw.length} 超过上限 ${MAX_PLAN_STEPS}`);
  }

  const sliced = raw.slice(0, MAX_PLAN_STEPS) as RawStep[];
  const seen = new Set<string>();
  const steps: ValidatedStep[] = [];

  sliced.forEach((s, i) => {
    const at = `步骤[${i}]`;
    if (!s || typeof s !== "object") {
      errors.push(`${at} 不是对象`);
      return;
    }

    // id
    const id = typeof s.id === "string" ? s.id.trim() : "";
    if (!id) {
      errors.push(`${at} 缺少 id`);
      return;
    }
    if (!ID_PATTERN.test(id)) {
      errors.push(
        `${at} id "${id}" 非法（需以字母开头，仅含字母数字 _ -，≤40 字符）`,
      );
      return;
    }
    if (seen.has(id)) {
      errors.push(`${at} id "${id}" 重复`);
      return;
    }
    seen.add(id);

    // tool —— 白名单硬校验
    const tool = typeof s.tool === "string" ? s.tool.trim() : "";
    if (!tool || tool === "null") {
      errors.push(
        `${at} 缺少 tool。可用工具: ${WORK_TOOL_CATALOG.map((t) => t.name).join(", ")}`,
      );
      return;
    }
    const spec = TOOL_MAP.get(tool);
    if (!spec) {
      errors.push(
        `${at} 工具 "${tool}" 不在白名单内。可用工具: ${WORK_TOOL_CATALOG.map((t) => t.name).join(", ")}`,
      );
      return;
    }

    // args —— 补齐合理默认值后过 zod schema 硬校验
    const rawArgs: Record<string, unknown> =
      s.args && typeof s.args === "object" ? { ...(s.args as Record<string, unknown>) } : {};

    // 智能兜底：模型经常把标题或问题放在 action/description 里，此处做无损补全
    if (tool === "business_report") {
      if (!rawArgs.title && typeof s.action === "string") rawArgs.title = s.action;
      if (!rawArgs.title && typeof s.description === "string") rawArgs.title = s.description.slice(0, 40);
      if (!rawArgs.title) rawArgs.title = "业务分析与复盘报告";
      if (!rawArgs.question && typeof s.description === "string") rawArgs.question = s.description;
      if (!rawArgs.question && typeof s.action === "string") rawArgs.question = s.action;
      if (!rawArgs.sourceStepIds && Array.isArray(s.dependsOn) && s.dependsOn.length > 0) {
        rawArgs.sourceStepIds = s.dependsOn.filter((d): d is string => typeof d === "string");
      }
    } else if (tool === "generate_text") {
      if (!rawArgs.instruction && typeof s.description === "string") rawArgs.instruction = s.description;
      if (!rawArgs.instruction && typeof s.action === "string") rawArgs.instruction = s.action;
      if (!rawArgs.instruction) rawArgs.instruction = "根据前序步骤进行分析与总结";
    }

    const parsed = spec.args.safeParse(rawArgs);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
        .join("; ");
      errors.push(`${at} 工具 "${tool}" 参数非法 — ${detail}`);
      return;
    }

    // dependsOn
    let dependsOn: string[] = [];
    if (s.dependsOn !== undefined && s.dependsOn !== null) {
      if (!Array.isArray(s.dependsOn)) {
        errors.push(`${at} dependsOn 必须是数组`);
        return;
      }
      dependsOn = s.dependsOn.filter((d): d is string => typeof d === "string");
    }

    const description =
      typeof s.description === "string" && s.description.trim()
        ? s.description.trim()
        : "";
    if (!description) {
      warnings.push(`${at} 缺少 description，已用 action 兜底`);
    }

    steps.push({
      id,
      action:
        typeof s.action === "string" && s.action.trim()
          ? s.action.trim()
          : tool,
      description:
        description || (typeof s.action === "string" ? s.action : tool),
      tool,
      // SAFETY: parsed.data 来自上面 spec.args.safeParse 成功分支，
      // 一定是该工具 zod schema 认定的合法入参对象。
      args: parsed.data as Record<string, unknown>,
      dependsOn,
      requiresActionApproval: spec.sideEffect,
      riskNote: spec.riskNote,
    });
  });

  // 悬空依赖：剔除并留痕（LLM 常见无害笔误，不值得整体失败）
  const known = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    const before = step.dependsOn.length;
    step.dependsOn = step.dependsOn.filter((d) => {
      if (known.has(d) && d !== step.id) return true;
      warnings.push(`步骤 ${step.id} 的依赖 "${d}" 不存在或自引用，已剔除`);
      return false;
    });
    if (step.dependsOn.length !== before) {
      // 剔除后可能改变拓扑，无需报错
    }
  }

  if (errors.length > 0) {
    return { ok: false, steps: [], errors, warnings };
  }

  // 环检测 —— 复用 planner 里已有的三色 DFS，不重写
  if (hasCycle(steps.map(toWorkStepShape))) {
    return {
      ok: false,
      steps: [],
      errors: ["dependsOn 存在循环依赖，无法拓扑排序"],
      warnings,
    };
  }

  return { ok: true, steps, errors: [], warnings };
}

/** hasCycle 只读 id/dependsOn，做最小结构适配，避免复制一份环检测。 */
function toWorkStepShape(s: ValidatedStep) {
  return {
    id: s.id,
    action: s.action,
    description: s.description,
    tool: s.tool,
    dependsOn: s.dependsOn,
    status: "pending" as const,
  };
}

/** 计划里是否含有需要 Action Approval 的步骤。 */
export function planRequiresActionApproval(steps: ValidatedStep[]): boolean {
  return steps.some((s) => s.requiresActionApproval);
}

/** 拓扑序（依赖在前）。调用前必须已通过 validateSteps 的无环校验。 */
export function topoOrder(steps: ValidatedStep[]): ValidatedStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const out: ValidatedStep[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const s = byId.get(id);
    if (!s) return;
    for (const dep of s.dependsOn) visit(dep);
    out.push(s);
  };
  for (const s of steps) visit(s.id);
  return out;
}

/** 下一步可执行集合：依赖全部 done 且自身 pending。 */
export function readySteps(
  steps: ValidatedStep[],
  doneIds: Set<string>,
): ValidatedStep[] {
  return steps.filter(
    (s) => !doneIds.has(s.id) && s.dependsOn.every((d) => doneIds.has(d)),
  );
}
