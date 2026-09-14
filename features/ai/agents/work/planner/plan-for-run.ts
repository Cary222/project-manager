/**
 * planForRun —— 为一个 Work run 生成并持久化计划版本。
 *
 * 三处共用同一实现，避免出现第二套规划逻辑：
 * 1. graph 的 planning 节点（首次规划）
 * 2. 计划被拒绝后的有界重规划（带拒绝反馈）
 * 3. 用户编辑计划后的重新校验落库
 *
 * 关键：**校验失败必须回喂 LLM**。
 * planner 曾宣传不存在的工具（searchStructured/generateText），
 * 若不把 critic 的 errors 原文喂回去，LLM 会稳定地重复同一个错误。
 * 这里做有界重试（默认 2 次），仍失败就把错误原样交给上层展示，不伪造成功计划。
 */

import "server-only";

import { callAgnes } from "@/features/ai/llm/summarizer";
import {
  MAX_PLAN_STEPS,
  toolCatalogPrompt,
  validateSteps,
  type ValidationResult,
} from "./validate";
import {
  savePlanVersion,
  type DataScope,
  type PlanRecord,
  type WorkRunStatus,
} from "../runtime/work-run-store";

/** 单次规划内 LLM 尝试次数上限（含首次）。 */
const MAX_PLAN_ATTEMPTS = 2;

export interface PlanForRunOptions {
  runId: string;
  userId: string;
  isRoot: boolean;
  /** 用户原始目标。 */
  userInput: string;
  /** 决策层抽出的实体与时间，作为规划输入而非路由依据。 */
  entities?: Record<string, unknown>;
  /** 数据权限范围说明，让 planner 知道数据边界。 */
  dataScope?: DataScope;
  /** 拒绝反馈 / 用户修改意见 —— 重规划时必须有。 */
  feedback?: string;
  /** 上一轮 critic 的错误，重试时回喂。 */
  previousErrors?: string[];
  /** 计划来源，写进 PlanRecord.origin。 */
  origin?: "initial" | "replan" | "edit";
}

export type PlanForRunResult =
  | { ok: true; plan: PlanRecord; warnings: string[]; attempts: number }
  | {
      ok: false;
      error: string;
      errors: string[];
      attempts: number;
      raw?: string;
    };

const PLANNER_SYSTEM = `你是任务规划器。把用户目标拆解成可执行的有序步骤。

硬性规则：
1. 只能使用「可用工具」清单里的 tool，禁止编造工具名或参数。
2. 步骤数 1~${MAX_PLAN_STEPS}。id 以字母开头，仅含字母数字 _ -。
3. dependsOn 只能引用本计划内已定义的 id，不能有环。
4. 有副作用的工具（清单里标注的）应尽量后置，减少被拒绝后的返工。
5. 每一步的 args 必须符合该工具的参数要求，不要省略必填参数。
6. 时间范围用 monthOffset（0=本月，1=上月）或 since/until（YYYY-MM-DD），按北京时间理解。
7. 统计「某时间段内曾经处于某状态」必须用 ticket_status_history + historyStatus，
   不要用 ticket 的当前状态字段 —— 那是当前快照，会算错历史。

输出严格 JSON（不要 markdown 代码块）：
{"title":"6~16字任务标题","steps":[{"id":"s1","action":"动作名","description":"做什么","tool":"工具名","args":{},"dependsOn":[]}]}`;

function cleanJson(raw: string): string {
  const trimmed = raw.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (match) return match[1].trim();
  return trimmed;
}

function buildUserPrompt(
  opts: PlanForRunOptions,
  retryErrors: string[],
): string {
  const scopeLine = opts.dataScope
    ? opts.dataScope.mode === "all_projects"
      ? "数据权限：全部项目（ROOT）"
      : `数据权限：该用户仅能读取其加入的 ${opts.dataScope.projectIds.length} 个项目`
    : "";

  return [
    "=== 可用工具 ===",
    toolCatalogPrompt(),
    "",
    scopeLine,
    "",
    "=== 用户目标 ===",
    opts.userInput,
    opts.entities && Object.keys(opts.entities).length > 0
      ? `\n已抽取的实体/时间（直接使用，不要重新推断）：\n${JSON.stringify(opts.entities, null, 2)}`
      : "",
    opts.feedback
      ? `\n=== 上一次被拒绝的原因（必须修正）===\n${opts.feedback}`
      : "",
    retryErrors.length > 0
      ? `\n=== 上一次计划未通过校验，请修正以下问题 ===\n${retryErrors.map((e) => `- ${e}`).join("\n")}`
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function planForRun(
  options: PlanForRunOptions,
): Promise<PlanForRunResult> {
  const retryErrors: string[] = [...(options.previousErrors ?? [])];
  let lastRaw: string | undefined;
  let lastErrors: string[] = retryErrors;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    attempts = attempt;
    let raw: string;
    try {
      const res = await callAgnes(
        [
          { role: "system", content: PLANNER_SYSTEM },
          { role: "user", content: buildUserPrompt(options, retryErrors) },
        ],
        { userId: options.userId },
      );
      raw = res.content;
      lastRaw = raw;
      
    } catch (err) {
      const message = err instanceof Error ? err.message : "规划调用失败";
      return {
        ok: false,
        error: message,
        errors: [message],
        attempts,
        raw: lastRaw,
      };
    }

    let parsed: { title?: unknown; steps?: unknown };
    try {
      parsed = JSON.parse(cleanJson(raw)) as {
        title?: unknown;
        steps?: unknown;
      };
    } catch {
      lastErrors = ["输出不是合法 JSON"];
      retryErrors.length = 0;
      retryErrors.push(...lastErrors);
      continue;
    }

    const validation: ValidationResult = validateSteps(parsed.steps);
    if (!validation.ok) {
      lastErrors = validation.errors;
      retryErrors.length = 0;
      retryErrors.push(...validation.errors);
      continue;
    }

    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 40)
        : options.userInput.slice(0, 20);

    const plan = await savePlanVersion(
      options.runId,
      options.userId,
      options.isRoot,
      {
        title,
        goal: options.userInput,
        steps: validation.steps,
        status: "pending_approval",
        validation: { ok: true, errors: [] },
        origin: {
          kind: options.origin ?? "initial",
          feedback: options.feedback,
        },
      },
      { status: "waiting_plan_approval", event: "plan_created" },
    );

    return { ok: true, plan, warnings: validation.warnings, attempts };
  }

  return {
    ok: false,
    error: `计划生成失败：${lastErrors.join("；")}`,
    errors: lastErrors,
    attempts,
    raw: lastRaw,
  };
}

/**
 * 用户编辑后的计划：走同一套 critic，落成新版本待批。
 * 编辑不能绕过校验 —— 否则用户（或注入的文本）可以塞进任意工具参数。
 */
export async function saveEditedPlan(options: {
  runId: string;
  userId: string;
  isRoot: boolean;
  userInput: string;
  title: string;
  steps: unknown;
}): Promise<PlanForRunResult> {
  const validation = validateSteps(options.steps);
  if (!validation.ok) {
    return {
      ok: false,
      error: `编辑后的计划未通过校验：${validation.errors.join("；")}`,
      errors: validation.errors,
      attempts: 1,
    };
  }

  const plan = await savePlanVersion(
    options.runId,
    options.userId,
    options.isRoot,
    {
      title: options.title.slice(0, 40),
      goal: options.userInput,
      steps: validation.steps,
      status: "pending_approval",
      validation: { ok: true, errors: [] },
      origin: { kind: "edit" },
    },
    { status: "waiting_plan_approval", event: "plan_edited" },
  );

  return { ok: true, plan, warnings: validation.warnings, attempts: 1 };
}

/** 计划被拒绝后，是否还能再重规划一轮。 */
export function canReplan(replanCount: number, maxReplans: number): boolean {
  return replanCount < maxReplans;
}

export type { WorkRunStatus };
