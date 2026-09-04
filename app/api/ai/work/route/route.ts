import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { callAgnes } from "@/features/ai/llm/summarizer";

import {
  ALL_PI_CAPABILITIES,
  type PiCommandKey,
  type PiCapability,
  type RoutePlanStep,
  type RoutePreflightResult,
} from "@/features/ai/agents/work/router/route-types";

export type { PiCommandKey, PiCapability, RoutePlanStep, RoutePreflightResult };
export { ALL_PI_CAPABILITIES };

const CAPABILITY_MAP = new Map<PiCommandKey, PiCapability>(
  ALL_PI_CAPABILITIES.map((c) => [c.key, c]),
);

const routeSchema = z.object({
  input: z.string().min(1, "提示词不能为空"),
  selectedCommands: z
    .array(z.enum(["plan", "goal", "review", "reach", "websearch"]))
    .optional(),
});

function getDefaultCommandKeys(input: string): PiCommandKey[] {
  const lower = input.toLowerCase();
  if (/审查|审计|audit|review|检查代码/.test(lower)) {
    return ["review", "goal"];
  }
  if (/搜索|查询|文档|资料|search|web/.test(lower)) {
    return ["websearch", "plan", "goal"];
  }
  if (/影响|依赖|关联|reach|范围/.test(lower)) {
    return ["reach", "plan", "goal", "review"];
  }
  // 默认黄金推荐路线：方案规划 → 目标交付 → 合规与质量审计
  return ["plan", "goal", "review"];
}

function buildDefaultStepPrompt(key: PiCommandKey, input: string): string {
  const clean = input.trim();
  switch (key) {
    case "plan":
      return `针对需求「${clean}」进行系统架构设计与任务拆解。梳理核心模块依赖、接口规范与风险边界，生成分步实施方案，暂不修改代码。`;
    case "goal":
      return `针对需求「${clean}」进行功能迭代与代码实现。编写核心业务逻辑，处理异常边界，并补齐单元测试直至交付完成。`;
    case "review":
      return `对「${clean}」的代码改动进行全面审查，重点核验是否存在过度设计、死代码、潜在安全漏洞与规范违规。`;
    case "reach":
      return `针对需求「${clean}」梳理调用链上下游依赖、关联组件受影响范围与验证边界。`;
    case "websearch":
      return `针对需求「${clean}」检索最新的技术规范、官方文档与最佳工程实践。`;
  }
}

function formatRawRouteOutput(
  bestRouteText: string,
  capabilities: PiCapability[],
  steps: RoutePlanStep[],
  confidence: string,
): string {
  const capLines = capabilities
    .map((c) => `  ✓ ${c.name} (${c.command}) (${c.description})`)
    .join("\n");

  const stepLines = steps
    .map(
      (s) =>
        `  ${s.index}. [${s.title}] -> 指令: ${s.command}\n     提示词: ${s.prompt}`,
    )
    .join("\n");

  return `================================================================
🎯 Pi Route 推荐工作流方案与指令规划
================================================================
最佳方案路线:
  ${bestRouteText}

当前可用能力:
${capLines}

分步执行指令与优化提示词规划:
${stepLines}

推荐置信度: ${confidence}
================================================================`;
}

/**
 * POST /api/ai/work/route
 *
 * 依据用户提示词及选中的命令集合，生成标准化的 Pi Route 方案与分步指令规划。
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const parsed = routeSchema.parse(body);

    const activeKeys: PiCommandKey[] =
      parsed.selectedCommands && parsed.selectedCommands.length > 0
        ? parsed.selectedCommands
        : getDefaultCommandKeys(parsed.input);

    const activeCapabilities: PiCapability[] = activeKeys
      .map((k) => CAPABILITY_MAP.get(k))
      .filter((c): c is PiCapability => Boolean(c));

    const bestRouteSteps = activeCapabilities.map((c) => c.name);
    const bestRouteText = bestRouteSteps.join("  →  ");

    // 默认分步提示词构造
    let steps: RoutePlanStep[] = activeCapabilities.map((c, idx) => ({
      index: idx + 1,
      key: c.key,
      title: `${c.name} (${c.command})`,
      command: c.command,
      prompt: buildDefaultStepPrompt(c.key, parsed.input),
    }));

    let confidence = "60%";

    // 尝试调用 AI 对每一步的提示词进行精细化优化
    try {
      const aiPrompt = `请对用户的开发目标生成结构化分步规划提示词：
用户需求：${parsed.input}
选定执行链路：${bestRouteText}
包含的命令：${activeCapabilities.map((c) => `${c.name}(${c.command})`).join(", ")}

请为选定的每个命令生成专属的高质量优化提示词，并严格输出 JSON 结构：
{
  "confidence": "60%",
  "steps": [
    ${activeCapabilities
      .map(
        (c) =>
          `{"key": "${c.key}", "prompt": "针对需求「${parsed.input}」具体要执行的任务描述..."}`,
      )
      .join(",\n    ")}
  ]
}`;

      const aiRes = await callAgnes(
        [
          {
            role: "system",
            content:
              "你是一个专业的软件工程任务拆解器。请根据用户需求和选定命令，为每个阶段生成清晰严谨的执行提示词，直接输出 JSON 结构（不要 markdown 代码块包裹）。",
          },
          {
            role: "user",
            content: aiPrompt,
          },
        ],
        { userId: session.user.id },
      );

      const cleaned = aiRes.content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsedJson = JSON.parse(cleaned);
      if (parsedJson.confidence) confidence = parsedJson.confidence;
      if (Array.isArray(parsedJson.steps) && parsedJson.steps.length > 0) {
        steps = activeCapabilities.map((c, idx) => {
          const match = parsedJson.steps.find(
            (s: { key?: string }) => s.key === c.key,
          );
          return {
            index: idx + 1,
            key: c.key,
            title: `${c.name} (${c.command})`,
            command: c.command,
            prompt:
              match?.prompt || buildDefaultStepPrompt(c.key, parsed.input),
          };
        });
      }
    } catch {
      // 容灾平滑兜底
    }

    const rawText = formatRawRouteOutput(
      bestRouteText,
      activeCapabilities,
      steps,
      confidence,
    );

    const result: RoutePreflightResult = {
      title: "🎯 Pi Route 推荐工作流方案与指令规划",
      bestRouteText,
      bestRouteSteps,
      availableCapabilities: activeCapabilities,
      selectedCommandKeys: activeKeys,
      steps,
      confidence,
      rawText,
    };

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "输入参数无效", details: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "预处理失败";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}
