/**
 * Work Decision Service —— 服务端唯一的策略决策点（C1）。
 *
 * 为什么不是前端正则：正则只能抽实体/日期/显式命令（预处理），
 * 不能决定业务走向。「统计上个月延期的所有外部工单，分析核心归因并输出复盘报告」
 * 这种复合目标，任何正则分支都会把它误判成单一步骤，或者把"外部"当成
 * 已支持的筛选条件静默丢掉 —— 结果是一份数字看着合理、语义全错的报告。
 *
 * 这里由 LLM 做语义决策，输出四种 mode：
 *   workflow — 命中已验证过的固定模板（周报/项目进展/会议纪要）
 *   planner  — 无模板匹配，需要动态拆解
 *   direct   — 单次工具调用即可，不需要拆解
 *   clarify  — 关键信息缺失，或用户要求的维度数据结构无法表达，先问人
 *
 * 最关键的一条：`unsupportedConcepts`。
 * 如果用户要求的筛选维度不在能力清单里（例如"外部工单" —— Ticket 表根本没有
 * 来源/内外字段），LLM 必须把它列出来并要求澄清，**不得用近似字段替代**，
 * 也不得静默忽略该条件。这是防"看起来对但实际错"的报告的核心闸门。
 */

import "server-only";

import { z } from "zod";
import { callAgnes } from "@/features/ai/llm/summarizer";
import { listWorkflows } from "../workflows/registry";
import { toolCatalogPrompt } from "../planner/validate";
import { resolveDataScope, type DataScope } from "../runtime/work-run-store";
import { prisma } from "@/shared/db/client";

// ============================================================================
// 输出契约
// ============================================================================

export const DECISION_MODES = [
  "workflow",
  "planner",
  "direct",
  "clarify",
] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

export interface UnsupportedConcept {
  /** 用户原话里的概念，如「外部工单」。 */
  concept: string;
  /** 为什么数据结构表达不了 —— 必须说明缺什么字段。 */
  why: string;
  /** 给人看的澄清问题。 */
  ask: string;
}

export interface Decision {
  mode: DecisionMode;
  /** 业务意图短标签，用于 UI 展示与日志归类。 */
  intent: string;
  /** 判断理由，必须在 UI 里展示给用户（可解释性要求）。 */
  reason: string;
  /** 抽取到的实体与时间，只作为 planner 的输入，不参与路由。 */
  entities: {
    projectId?: string;
    projectName?: string;
    monthOffset?: number;
    since?: string;
    until?: string;
    ticketStatus?: string[];
    historyStatus?: string;
  };
  /** mode=workflow 时的模板 type。 */
  requestedWorkflow?: string;
  /** mode=clarify 时缺什么。 */
  missingInfo: string[];
  /** mode=clarify 时给用户看的问题。 */
  clarification?: string;
  /** 用户要求但数据结构无法表达的筛选维度。非空时必须 mode=clarify。 */
  unsupportedConcepts: UnsupportedConcept[];
  confidence: number;
}

// ============================================================================
// 能力清单 —— 从真实 schema 生成，不手写会腐烂的黑名单
// ============================================================================

/**
 * Work 可查询的业务维度。这里的每一项都必须对应真实存在的 Prisma 字段。
 * Decision LLM 只能从这里选；清单外的需求 → unsupportedConcepts。
 */
export const CAPABILITY_MANIFEST = `
available business dimensions (ONLY these fields can be used as filters):

- project           项目。   filters: 项目名, 项目状态
- ticket            工单。   filters: 所属项目, 当前状态(DEVELOPING|READY_FOR_TEST|DONE|DELIVERED|OVERDUE|CLOSED),
                              优先级(整数), 截止日期, 更新时间范围
- ticket_status_history  工单状态变更历史。
                              filters: 历史状态, 变更时间范围, 所属项目
                              用途: 「某段时间内*曾经*处于某状态」这类历史统计必须用它，
                                    不能用 ticket 的当前状态代替
- meeting           会议。   filters: 所属项目, 会议日期范围, 会议状态
- commit            Git提交。filters: 提交时间范围, 所属项目(经关联工单), 作者, 仓库路径
- weekly_report     周报。   filters: 周范围（仅当前用户自己的）

fields that DO NOT exist anywhere in the ticket schema (do not invent them):
- 工单没有「外部/内部」来源字段
- 工单没有「客户/供应商/外部方」字段
- 工单没有「延期原因」字段（只有状态变更历史，没有原因）
- 工单没有「类型/分类」字段
`.trim();

function manifestForPrompt(): string {
  const templates = listWorkflows().filter((t) => t.type !== "coding");
  const templateLines = templates
    .map((t) => {
      const nodes = t.nodes?.map((n) => n.label ?? n.id).join(" → ") ?? "";
      return `- ${t.type}（${t.name}）${nodes ? `: ${nodes}` : ""}`;
    })
    .join("\n");

  return [
    "=== 已验证的固定工作流模板（命中则应选 workflow）===",
    templateLines || "（无）",
    "",
    "=== Work 可用工具（planner/direct 只能用这些）===",
    toolCatalogPrompt(),
    "",
    "=== 可查询的业务维度 ===",
    CAPABILITY_MANIFEST,
  ].join("\n");
}

// ============================================================================
// LLM 原始输出
// ============================================================================

const RawDecision = z.object({
  mode: z.enum(DECISION_MODES),
  intent: z.string().max(60).optional(),
  reason: z.string().max(600).optional(),
  entities: z
    .object({
      projectId: z.string().max(64).optional(),
      projectName: z.string().max(200).optional(),
      monthOffset: z.number().int().min(0).max(120).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      ticketStatus: z.array(z.string().max(40)).max(6).optional(),
      historyStatus: z.string().max(40).optional(),
    })
    .partial()
    .optional(),
  requestedWorkflow: z.string().max(60).optional(),
  missingInfo: z.array(z.string().max(300)).max(8).optional(),
  clarification: z.string().max(600).optional(),
  unsupportedConcepts: z
    .array(
      z.object({
        concept: z.string().max(120),
        why: z.string().max(400),
        ask: z.string().max(400),
      }),
    )
    .max(6)
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const SYSTEM_PROMPT = `你是 Work Agent 的服务端策略决策器（Orchestrator）。

你的职责：判断用户这个目标应该怎么执行。你不执行任务，只做决策。

四种 mode：
1. "workflow" — 目标能被某个**已验证的固定模板**完整覆盖时选它，并在 requestedWorkflow 填模板 type。
2. "planner"  — 没有模板能覆盖，目标需要多步拆解、跨实体聚合、或产出新内容（如复盘报告）。
3. "direct"   — 单次工具调用就能回答，不需要拆解。
4. "clarify"  — 见下方两条强制条件。

**强制选 clarify 的两种情况（优先级最高）：**
A. 用户的筛选条件里有「可查询的业务维度」清单之外的维度。哪怕只是修饰词（如"外部工单"），
   也必须放进 unsupportedConcepts，说明缺什么字段，并给出澄清问题。
   绝不能：用近似字段替代 / 静默忽略该条件 / 假装已按该条件过滤。
B. 关键执行参数缺失且无法从上下文推断（例如"统计延期工单"但没说是哪个时间段，
   而又无法从"上个月"这类相对表述推出绝对范围）。

**其他硬性规则：**
- 纯闲聊、问你是谁、无业务内容 → mode="direct"，intent 说明，不编造业务动作。
- 时间一律按北京时间（Asia/Shanghai）理解。"上个月" → monthOffset=1，"本月" → monthOffset=0。
- 历史状态统计一律用 historyStatus + 时间范围，不要用当前状态字段。
- 不要输出任何工具参数细节，那是 planner 的事。

输出严格 JSON（不要 markdown 代码块，不要解释文字）：
{
  "mode": "workflow|planner|direct|clarify",
  "intent": "简短中文意图标签",
  "reason": "一句话说明为什么这么判断（会给用户看）",
  "entities": { "monthOffset": 1, "historyStatus": "OVERDUE" },
  "requestedWorkflow": "仅 mode=workflow 时填模板 type",
  "missingInfo": ["仅 mode=clarify 时填"],
  "clarification": "仅 mode=clarify 时填，给用户看的问题",
  "unsupportedConcepts": [{"concept":"外部工单","why":"Ticket 表没有内外来源字段","ask":"请说明外部指什么"}],
  "confidence": 0.0
}`;

function cleanJson(raw: string): string {
  const trimmed = raw.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (match) return match[1].trim();
  return trimmed;
}

// ============================================================================
// 决策
// ============================================================================

export interface DecisionContext {
  userId: string;
  /** 会话里前几轮的用户输入，给"那再按项目分组"这类省略指代提供上下文。 */
  recentInputs?: string[];
  /**
   * 用户在 UI 上显式选定的流程（如手动点「周报」）。
   * 这是**显式指令**，不是正则推断 —— 直接采信、跳过 LLM 理解，
   * 但仍走同一套 normalize 与白名单校验，不允许借此绕过校验。
   * 取值同 WorkRoute：weekly_report / project_progress / meeting_minutes / planning。
   */
  forcedWorkflow?: string;
}

export interface DecisionResult {
  decision: Decision;
  dataScope: DataScope;
  /** LLM 原始文本，调试与审计用。 */
  raw?: string;
  /** 决策降级原因（LLM 失败时）。 */
  degraded?: string;
}

const FALLBACK: Decision = {
  mode: "planner",
  intent: "未知目标",
  reason: "决策服务不可用，退回通用拆解流程",
  entities: {},
  missingInfo: [],
  unsupportedConcepts: [],
  confidence: 0,
};

export async function decideWorkStrategy(
  userInput: string,
  ctx: DecisionContext,
): Promise<DecisionResult> {
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { role: true },
  });
  const dataScope = await resolveDataScope(ctx.userId, user?.role ?? "USER");

  // 显式指令短路：用户手动选了流程就不必再问 LLM。
  // 仍然走 normalize()，所以非法/不支持的取值会被降级而不是放行。
  if (ctx.forcedWorkflow) {
    return {
      decision: normalize({
        mode: ctx.forcedWorkflow === "planning" ? "planner" : "workflow",
        intent: ctx.forcedWorkflow,
        reason:
          "你在界面上显式指定了该流程，已按你的选择执行（未经自动推断）。",
        requestedWorkflow:
          ctx.forcedWorkflow === "planning" ? undefined : ctx.forcedWorkflow,
        confidence: 1,
      }),
      dataScope,
    };
  }
  const scopeLine =
    dataScope.mode === "all_projects"
      ? "该用户是 ROOT，可读取全部项目数据。"
      : `该用户是普通用户，只能读取其加入的 ${dataScope.projectIds.length} 个项目的数据。`;

  const history =
    ctx.recentInputs && ctx.recentInputs.length > 0
      ? `最近的对话上下文（供指代消解）：\n${ctx.recentInputs.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      : "";

  let raw: string | undefined;
  try {
    const res = await callAgnes(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            manifestForPrompt(),
            "",
            "=== 数据权限 ===",
            scopeLine,
            "",
            history,
            "",
            "=== 用户目标 ===",
            userInput,
          ]
            .filter((l) => l !== "")
            .join("\n"),
        },
      ],
      { userId: ctx.userId },
    );
    raw = res.content;
    

    let jsonParsed: unknown;
    try {
      jsonParsed = JSON.parse(cleanJson(res.content));
    } catch (jsonErr) {
      const msg = `JSON 解析失败: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}; 原始内容: ${res.content.slice(0, 200)}`;
      console.error("[decideWorkStrategy]", msg);
      return { decision: FALLBACK, dataScope, raw, degraded: msg };
    }
    const parsed = RawDecision.safeParse(jsonParsed);
    if (!parsed.success) {
      const msg = `决策输出不合 schema: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}; 原始内容: ${res.content.slice(0, 200)}`;
      console.error("[decideWorkStrategy]", msg);
      return {
        decision: FALLBACK,
        dataScope,
        raw,
        degraded: msg,
      };
    }

    return { decision: normalize(parsed.data), dataScope, raw };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "决策调用失败";
    console.error("[decideWorkStrategy] catch error:", err);
    
    return {
      decision: FALLBACK,
      dataScope,
      raw,
      degraded: msg,
    };
  }
}

/** 把 LLM 输出收敛成自洽的 Decision —— 不信任它自己填的一致性。 */
function normalize(raw: z.infer<typeof RawDecision>): Decision {
  const unsupported = raw.unsupportedConcepts ?? [];
  const missingInfo = raw.missingInfo ?? [];

  let mode: DecisionMode = raw.mode;

  // 服务端强制：有不可表达的维度就一定先澄清，不管 LLM 填了什么 mode。
  if (unsupported.length > 0 || missingInfo.length > 0) {
    mode = "clarify";
  }

  // workflow 但拿不出合法模板 → 降级为 planner，不猜模板。
  const templates = new Set(listWorkflows().map((t) => t.type));
  let requestedWorkflow = raw.requestedWorkflow;
  if (mode === "workflow") {
    if (!requestedWorkflow || !templates.has(requestedWorkflow)) {
      mode = "planner";
      requestedWorkflow = undefined;
    }
  } else {
    requestedWorkflow = undefined;
  }

  const clarification =
    raw.clarification ??
    (unsupported.length > 0
      ? unsupported.map((u) => u.ask).join("\n")
      : missingInfo.length > 0
        ? `需要补充以下信息：${missingInfo.join("、")}`
        : undefined);

  return {
    mode,
    intent: raw.intent?.trim() || "业务目标",
    reason: raw.reason?.trim() || "依据目标复杂度选择执行策略",
    entities: raw.entities ?? {},
    requestedWorkflow,
    missingInfo,
    clarification,
    unsupportedConcepts: unsupported,
    confidence: raw.confidence ?? 0.5,
  };
}

/** 给 UI 的决策摘要 —— 用户必须能看到"为什么这么走"。 */
export function describeDecision(d: Decision): string {
  const modeLabel: Record<DecisionMode, string> = {
    workflow: "已匹配固定工作流模板",
    planner: "无模板匹配，进入动态规划",
    direct: "单步执行即可",
    clarify: "信息不足，先向你确认",
  };
  const lines = [`${modeLabel[d.mode]}（${d.intent}）`, d.reason];
  if (d.unsupportedConcepts.length > 0) {
    lines.push(
      "",
      "⚠️ 以下条件当前数据结构无法表达，已暂停执行：",
      ...d.unsupportedConcepts.map((u) => `- 「${u.concept}」：${u.why}`),
    );
  }
  if (d.missingInfo.length > 0) {
    lines.push("", `缺少信息：${d.missingInfo.join("、")}`);
  }
  return lines.join("\n");
}
