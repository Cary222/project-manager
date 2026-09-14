/**
 * Evaluator —— 计划执行完毕后的质量评估器（C10）。
 *
 * 职责：
 * 在所有步骤执行完毕（status=done）后，客观评估最终产物是否真正达成了用户最初的目标。
 *
 * 输出判定：
 * - "done"        : 核心交付物完整，数据真实可溯，诚实标注局限。进入终态。
 * - "replan"      : 交付物有明显缺失但可由其他工具或重规划补齐，且在重规划预算内。
 * - "needs_human" : 发现不可克服的语义歧义或需用户决策。
 * - "failed"      : 执行严重脱靶且不可恢复。
 */

import "server-only";

import { z } from "zod";
import { callAgnes } from "@/features/ai/llm/summarizer";
import type {
  EvaluationRecord,
  StepRecord,
  ValidatedStep,
} from "../runtime/work-run-store";

export const EvaluationSchema = z.object({
  verdict: z.enum(["done", "incomplete", "blocked", "replan", "needs_human", "failed"]),
  reason: z.string().max(600),
  observed: z.array(z.string().max(200)).max(8),
});

export type EvaluationOutput = z.infer<typeof EvaluationSchema>;

const EVALUATOR_SYSTEM = `你是 Work Agent 的质量评估器（Evaluator）。
你的职责：客观审查任务执行全过程的产出，判定用户最初的目标是否已被高质量满足。

判定标准：
1. "done"：核心诉求已达成。若客观数据受限（例如字段缺失），只要报告诚实声明了边界与局限且逻辑严密，即算达成。
2. "replan"：步骤虽然跑完了，但核心产物明显偏离目标、缺少关键依赖数据，且可通过调整步骤或参数重试解决。
3. "needs_human"：遇到需要人工定夺的语义分歧或重大不可自动克服的障碍。
4. "failed"：完全无法满足交付物，无可挽回。

输出严格 JSON（不要代码块）：
{"verdict":"done|replan|needs_human|failed","reason":"评估理由","observed":["观察事实1","观察事实2"]}`;

function cleanJson(raw: string): string {
  const trimmed = raw.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (match) return match[1].trim();
  return trimmed;
}

export interface EvaluatePlanOptions {
  userId: string;
  goal: string;
  steps: ValidatedStep[];
  stepResults: Record<string, StepRecord>;
  stepOutputs: Record<string, unknown>;
}

export async function evaluatePlanExecution(
  options: EvaluatePlanOptions,
): Promise<EvaluationRecord> {
  const { userId, goal, steps, stepResults, stepOutputs } = options;

  // 整理步骤执行概况与产物摘要给评估器
  const stepSummaries = steps.map((s, idx) => {
    const r = stepResults[s.id];
    const out = stepOutputs[s.id];
    let outPreview = "(无输出)";
    if (out) {
      const str = typeof out === "string" ? out : JSON.stringify(out);
      outPreview = str.slice(0, 1000);
    }
    return [
      `步骤 ${idx + 1} [${s.id}] ${s.action} (${s.tool})`,
      `描述: ${s.description}`,
      `状态: ${r?.status ?? "未知"}`,
      `产出摘要: ${outPreview}`,
    ].join("\n");
  });

  try {
    const res = await callAgnes(
      [
        { role: "system", content: EVALUATOR_SYSTEM },
        {
          role: "user",
          content: [
            `【用户原始目标】: ${goal}`,
            "",
            "【各步骤执行结果与产物】:",
            stepSummaries.join("\n\n"),
          ].join("\n"),
        },
      ],
      { userId },
    );

    const parsed = EvaluationSchema.safeParse(
      JSON.parse(cleanJson(res.content)),
    );
    if (parsed.success) {
      return {
        verdict: parsed.data.verdict,
        reason: parsed.data.reason,
        observed: parsed.data.observed,
        at: Date.now(),
      };
    }
  } catch (err) {
    console.error("[evaluatePlanExecution] evaluation call failed:", err);
  }

  // 降级兜底：如果所有步骤均成功完成且无报错，默认为 done
  const allDone = steps.every((s) => stepResults[s.id]?.status === "done");
  return {
    verdict: allDone ? "done" : "failed",
    reason: allDone
      ? "所有规划步骤均顺利执行完成，产物已成功生成。"
      : "部分步骤未正常完成。",
    observed: steps.map(
      (s) => `${s.action}: ${stepResults[s.id]?.status ?? "unknown"}`,
    ),
    at: Date.now(),
  };
}
