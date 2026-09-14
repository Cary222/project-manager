/**
 * generate_text —— 无副作用的 LLM 文本生成步骤。
 *
 * 用途：planner 需要一个纯粹的「分析/提炼」步骤，但不产出完整报告时。
 * 与 business_report 的区别：报告有固定的来源表与数字溯源要求，
 * 这里只是基于上游产出做文本加工。
 *
 * 同样不允许凭空生成：可以没有 sourceStepIds（纯文本任务），
 * 但一旦给了 sourceStepIds，取不到产出的步骤必须如实记入 missingStepIds。
 */

import "server-only";

import { z } from "zod";
import type {
  ToolDefinition,
  ToolExecutionResult,
} from "@/features/ai/runtime/tool-registry";
import { callAgnes } from "@/features/ai/llm/summarizer";

export const GenerateTextArgs = z.object({
  instruction: z.string().min(1).max(4000),
  sourceStepIds: z.array(z.string()).max(10).optional(),
});

export interface GenerateTextDetails {
  text: string;
  groundedOnStepIds: string[];
  missingStepIds: string[];
}

export type GenerateTextOutcome =
  | { ok: true; details: GenerateTextDetails }
  | { ok: false; error: string };

export async function runGenerateText(
  userId: string,
  rawArgs: unknown,
  stepOutputs: Record<string, unknown>,
): Promise<GenerateTextOutcome> {
  const parsed = GenerateTextArgs.safeParse(rawArgs);
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

  const grounded: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];

  for (const stepId of args.sourceStepIds ?? []) {
    const out = stepOutputs[stepId];
    if (out === undefined) {
      missing.push(stepId);
      continue;
    }
    grounded.push(stepId);
    blocks.push(
      `### 上游步骤 ${stepId} 产出\n\`\`\`json\n${JSON.stringify(out, null, 2).slice(0, 20_000)}\n\`\`\``,
    );
  }

  const hasSources = (args.sourceStepIds?.length ?? 0) > 0;

  const llm = await callAgnes(
    [
      {
        role: "system",
        content: [
          "你是文本处理助手。",
          hasSources
            ? "只能依据提供的「上游步骤产出」作答；未覆盖的内容必须写「数据未覆盖」，禁止编造数字。"
            : "按指令直接完成文本任务。",
          "输出简体中文。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `指令: ${args.instruction}`,
          missing.length > 0
            ? `\n⚠️ 以下上游步骤取不到产出，相关结论不成立: ${missing.join(", ")}`
            : "",
          blocks.length > 0
            ? `\n===== 上游步骤产出 =====\n${blocks.join("\n\n")}`
            : "",
        ]
          .filter((l) => l !== "")
          .join("\n"),
      },
    ],
    { userId },
  );

  return {
    ok: true,
    details: {
      text: llm.content.trim(),
      groundedOnStepIds: grounded,
      missingStepIds: missing,
    },
  };
}

export function createGenerateTextTool(
  getStepOutputs: (ctx: { runId: string }) => Record<string, unknown>,
): ToolDefinition<GenerateTextDetails | null> {
  return {
    name: "generate_text",
    description: "调用 LLM 基于上游步骤结果生成分析文本（只读，无外部副作用）",
    inputSchema: GenerateTextArgs,
    permission: "read",
    agentTypes: ["WORK"],
    async execute(
      ctx,
      args,
    ): Promise<ToolExecutionResult<GenerateTextDetails | null>> {
      const res = await runGenerateText(
        ctx.userId,
        args,
        getStepOutputs({ runId: ctx.runId }),
      );
      if (!res.ok) {
        return { content: res.error, details: null, isError: true };
      }
      return { content: res.details.text, details: res.details };
    },
  };
}
