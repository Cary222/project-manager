/**
 * business_report —— 基于上游步骤真实产出生成报告（C7）。
 *
 * 核心约束：报告不能凭空生成。
 * - sourceStepIds 必须指向已有的步骤产出，找不到就记进 missingStepIds，
 *   并在报告的「数据来源与边界」里显式声明该来源缺失。
 * - 所有数字直接取自 BusinessQueryDetails 的 total/returned/truncated，
 *   不由 LLM 复述（LLM 复述数字是幻觉的主要入口）。
 * - 证据明细内联上限 REPORT_INLINE_LIMIT 条，超出只给计数 + 截断标记。
 */

import "server-only";

import { z } from "zod";
import type {
  ToolDefinition,
  ToolExecutionResult,
} from "@/features/ai/runtime/tool-registry";
import { callAgnes } from "@/features/ai/llm/summarizer";
import { WORK_TIMEZONE } from "./time-window";
import type { BusinessQueryDetails } from "./business-query";

/** 报告里单个来源最多内联多少条明细，超出只给计数 + 截断标记。 */
export const REPORT_INLINE_LIMIT = 30;

export const ReportArgs = z.object({
  title: z.string().min(1).max(200),
  /** 报告要回答的问题，来自用户原始目标。 */
  question: z.string().min(1).max(1000),
  /** 上游步骤 id，报告必须基于它们的产出。 */
  sourceStepIds: z.array(z.string()).min(1).max(10),
  format: z.enum(["markdown", "json"]).optional(),
});

export type ReportInput = z.infer<typeof ReportArgs>;

export interface ReportSource {
  stepId: string;
  entity: string;
  window: string;
  total: number;
  returned: number;
  truncated: boolean;
  dataScope: string;
}

export interface BusinessReportDetails {
  title: string;
  question: string;
  markdown: string;
  sources: ReportSource[];
  /** 实际采信为证据的步骤 id。 */
  groundedOnStepIds: string[];
  /** 声明了但取不到产出的步骤 id —— 报告里必须显式承认。 */
  missingStepIds: string[];
  generatedAt: string;
}

function scopeLabel(d: BusinessQueryDetails): string {
  return d.dataScope.mode === "all_projects"
    ? "全部项目（ROOT）"
    : `成员项目 ${d.dataScope.projectCount} 个${d.dataScope.truncated ? "（已截断）" : ""}`;
}

/** 判断某个步骤产出是否是可作为证据的业务查询结果。 */
function asQueryDetails(value: unknown): BusinessQueryDetails | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<BusinessQueryDetails>;
  if (typeof v.entity !== "string") return null;
  if (typeof v.total !== "number") return null;
  if (!v.window || typeof v.window.label !== "string") return null;
  if (!Array.isArray(v.items)) return null;
  return v as BusinessQueryDetails;
}

export type ReportOutcome =
  | { ok: true; details: BusinessReportDetails }
  | { ok: false; error: string };

export async function buildBusinessReport(
  userId: string,
  rawArgs: unknown,
  stepOutputs: Record<string, unknown>,
): Promise<ReportOutcome> {
  const parsed = ReportArgs.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      ok: false,
      error: `参数非法 — ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    };
  }
  const args = parsed.data;

  const sources: ReportSource[] = [];
  const grounded: string[] = [];
  const missing: string[] = [];
  const evidenceBlocks: string[] = [];
  const inlineCounts: number[] = [];

  for (const stepId of args.sourceStepIds) {
    const details = asQueryDetails(stepOutputs[stepId]);
    if (!details) {
      missing.push(stepId);
      continue;
    }
    grounded.push(stepId);
    sources.push({
      stepId,
      entity: details.entity,
      window: details.window.label,
      total: details.total,
      returned: details.returned,
      truncated: details.truncated,
      dataScope: scopeLabel(details),
    });

    const inline = details.items.slice(0, REPORT_INLINE_LIMIT);
    inlineCounts.push(inline.length);
    evidenceBlocks.push(
      [
        `### 来源 ${stepId} — ${details.entity}`,
        `- 时间范围: ${details.window.label}`,
        `- 数据权限: ${scopeLabel(details)}`,
        `- 命中总数: ${details.total}`,
        `- 本次内联明细: ${inline.length} / 返回 ${details.returned}${details.truncated ? "（结果已截断）" : ""}`,
        "",
        "```json",
        JSON.stringify(inline, null, 2),
        "```",
      ].join("\n"),
    );
  }

  // 没有任何可用证据 → 拒绝生成。宁可失败，也不产出一份编造的报告。
  if (grounded.length === 0) {
    return {
      ok: false,
      error: `没有任何可用来源产出（缺失: ${missing.join(", ") || "无 sourceStepIds"}）。报告不能凭空生成。`,
    };
  }

  const llm = await callAgnes(
    [
      {
        role: "system",
        content: [
          "你是数据分析助手。只能依据用户提供的「证据数据」作答。",
          "硬性要求：",
          "1. 所有数字必须直接来自证据数据，禁止估算、外推、编造。",
          "2. 证据未覆盖的部分必须明确写「数据未覆盖」，不得猜测。",
          "3. 严格区分「数据显示的事实」与「基于事实的推断」。",
          "4. 若证据里存在语义不确定的维度（例如某个筛选概念在数据结构中无对应字段），",
          "   必须在「数据边界与局限」中明确指出，不得用近似字段替代。",
          "5. 输出简体中文 Markdown，依次包含：核心结论 / 数据事实 / 归因分析 / 数据边界与局限。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `分析目标: ${args.question}`,
          "",
          missing.length > 0
            ? `⚠️ 以下来源声明了但取不到产出，必须在「数据边界与局限」中声明: ${missing.join(", ")}`
            : "",
          "",
          "===== 证据数据 =====",
          "",
          evidenceBlocks.join("\n\n"),
        ]
          .filter((line) => line !== "")
          .join("\n"),
      },
    ],
    { userId },
  );

  const analysis = llm.content.trim();
  const generatedAt = new Date().toISOString();

  const markdown =
    args.format === "json"
      ? JSON.stringify(
          {
            title: args.title,
            question: args.question,
            sources,
            missingStepIds: missing,
            analysis,
            generatedAt,
            timezone: WORK_TIMEZONE,
          },
          null,
          2,
        )
      : [
          `# ${args.title}`,
          "",
          `> 分析问题：${args.question}`,
          `> 生成时间：${generatedAt}（${WORK_TIMEZONE}）`,
          "",
          analysis,
          "",
          "---",
          "",
          "## 数据来源与边界",
          "",
          "| 来源步骤 | 实体 | 时间范围 | 数据权限 | 命中总数 | 内联明细 | 截断 |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...sources.map(
            (s, i) =>
              `| ${s.stepId} | ${s.entity} | ${s.window} | ${s.dataScope} | ${s.total} | ${inlineCounts[i]} | ${s.truncated ? "是" : "否"} |`,
          ),
          "",
          missing.length > 0
            ? `⚠️ **缺失来源**：${missing.join(", ")} —— 依赖这些来源的结论不成立，已在分析中标注「数据未覆盖」。`
            : "全部声明来源均取到产出。",
          "",
          "_本报告由 Work Agent 自动生成，数字直接取自服务端查询结果，未经 LLM 复述修改。_",
        ].join("\n");

  return {
    ok: true,
    details: {
      title: args.title,
      question: args.question,
      markdown,
      sources,
      groundedOnStepIds: grounded,
      missingStepIds: missing,
      generatedAt,
    },
  };
}

/**
 * stepOutputs 由 executor 注入（stepId → 该步骤 tools 结果 details）。
 * ToolDefinition.execute 的 ctx 里没有 stepOutputs，所以这里走一个显式的
 * 闭包注入点，避免把执行上下文塞进全局。
 */
export function createBusinessReportTool(
  getStepOutputs: (ctx: { runId: string }) => Record<string, unknown>,
): ToolDefinition<BusinessReportDetails | null> {
  return {
    name: "business_report",
    description:
      "基于上游步骤产出生成结构化复盘/归因报告，必须带来源、命中计数与截断标记",
    inputSchema: ReportArgs,
    permission: "read",
    agentTypes: ["WORK"],
    async execute(
      ctx,
      args,
    ): Promise<ToolExecutionResult<BusinessReportDetails | null>> {
      const res = await buildBusinessReport(
        ctx.userId,
        args,
        getStepOutputs({ runId: ctx.runId }),
      );
      if (!res.ok) {
        return { content: res.error, details: null, isError: true };
      }
      return { content: res.details.markdown, details: res.details };
    },
  };
}
