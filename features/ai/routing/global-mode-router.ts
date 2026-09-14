/**
 * Global Mode Router —— 全局产品级模式路由器。
 *
 * 核心职责：
 * 在用户发起请求之前，判断用户是在“想知道什么”（Chat: Answer Runtime）
 * 还是“想完成什么”（Work: Goal Execution Runtime）。
 *
 * 核心原则：
 * 1. 语义决策而非死板关键词：绝不简单依靠“提交=Work，查询=Chat”；
 * 2. 保守切换：Chat 内部更加克制，不因偶然提到“周报/代码”就强跳模式；
 * 3. 结果向下复用：输出 goalType、intent、workSuggestion，供下游免重复解析；
 * 4. 容灾降级：大模型超时或异常时安全回退至 Chat 模式。
 */

import { callAgnes } from "@/features/ai/llm/summarizer";
import {
  type ModeDecision,
  type GlobalRouterContext,
  ModeDecisionSchema,
} from "./types";
import { extractExplicitMentions } from "@/features/ai/core/context/context-resolver";

const FAST_GREETING_REGEX =
  /^(?:你好|您好|hi|hello|嗨|嗨你好|你好呀|在吗|在不在|在嘛|哈喽|早上好|下午好|晚上好|谢谢|谢谢你|多谢|感谢|好的|好的好的|好嘞|收到|明白|再见|拜拜)\s*[!！.?。~～]*$/i;

const FAST_IDENTITY_REGEX =
  /^(?:你是谁|你叫什么|你叫什么名字|你是小星吗|你是谁开发|你是做什么的|你是什么|你是什么模型|介绍一下你自己|你能做(?:什么|哪些|点啥)|你有什么功能|你可以帮我做什么|你能帮我做什么|使用说明|功能列表|怎么使用|怎么用)\s*[?？!！.。]*$/i;

const SYSTEM_PROMPT = `你是系统的全局模式分流路由器（Global Mode Router）。
用户输入可能来自欢迎页或对话页。你需要客观判断用户的核心目标是：
- "想知道/获取/理解/分析信息"（Chat: Answer Runtime）
- "想完成/交付/执行实际动作"（Work: Goal Execution Runtime）

四种路由取值：
1. "chat"：用户想了解某个知识、查询状态、获取某个工单/项目/人员的详情、或者单纯对话。
   例如：“#10208 是什么问题？”、“张工本周在做什么？”、“周报是什么格式？”、“帮我分析为什么延期。”
2. "work"：用户明确希望产出正式交付物、提交报告、发起多步规划、或修改代码。
   例如：“生成本周周报”、“提交这份周报”、“把刚才的问题整理成复盘文档”、“修改 #10208 对应代码并测试”。
3. "chat_then_offer_work"：用户在进行深度归因分析，但分析后极可能需要跟进动作。
   例如：“深度分析上个月工单延期原因”、“排查登录接口性能瓶颈”。
4. "stay_current"：保持用户当前所在的模式。

直接输出严格 JSON（不要代码块，不要解释文字）：
{
  "route": "chat|work|chat_then_offer_work|stay_current",
  "intent": "简短意图标签",
  "goalType": "informational|analytical|actionable|transactional",
  "requiresExecution": true或false,
  "confidence": 0.0到1.0,
  "workSuggestion": {
    "workflowHint": "weekly_report|project_progress|meeting_minutes|coding|null",
    "capability": "coding.execute|report.generate|null",
    "reason": "为什么建议该动作"
  }
}`;

function cleanJson(raw: string): string {
  const trimmed = raw.trim();
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (match) return match[1].trim();
  return trimmed;
}

/**
 * 全局模式路由决策主函数
 */
export async function decideGlobalMode(
  input: string,
  context?: GlobalRouterContext,
): Promise<ModeDecision> {
  const trimmed = input.trim();

  // 1. 0ms 快路径：打招呼与元问题 -> 必定 Chat
  if (FAST_GREETING_REGEX.test(trimmed) || FAST_IDENTITY_REGEX.test(trimmed)) {
    return {
      route: "chat",
      intent: "greeting_or_meta",
      goalType: "informational",
      requiresExecution: false,
      confidence: 1.0,
    };
  }

  // 提取显式实体标记
  const mentions = extractExplicitMentions(trimmed);
  const extractedEntities: Record<string, string> = {};
  if (mentions.ticketNumbers.length > 0) {
    extractedEntities.ticketNo = String(mentions.ticketNumbers[0]);
  }
  if (mentions.userMentions.length > 0) {
    extractedEntities.userName = mentions.userMentions[0];
  }

  // 2. 0ms 快路径：纯问答引导词（“是什么”、“怎么看”、“为什么”、“有哪些”）且不含动作动词
  const isPureQuestion =
    /^(?:请问|查一下|查看|了解)?.*(?:是什么|有哪些|怎么样|进度如何|怎么样了|在哪|详情|为什么|是谁)\s*[?？]*$/i.test(
      trimmed,
    ) && !/(?:生成|提交|创建|发布|修改|修复|执行|改代码)/i.test(trimmed);

  if (isPureQuestion) {
    return {
      route: "chat",
      intent: "information_lookup",
      goalType: "informational",
      requiresExecution: false,
      confidence: 0.95,
      extractedEntities,
    };
  }

  // 3. LLM 语义路由判断（微型模型，极简 Prompt，超时 1200ms 兜底）
  try {
    const userPrompt = [
      `用户输入: "${trimmed}"`,
      context?.currentRoute ? `当前所处界面: ${context.currentRoute}` : null,
      context?.recentInputs && context.recentInputs.length > 0
        ? `最近交互: ${context.recentInputs.slice(-2).join(" -> ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await Promise.race([
      callAgnes(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { userId: context?.userId, preferredModelRef: "agnes:agnes-2.0-flash" },
      ),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("GlobalRouter timeout")), 1200),
      ),
    ]);

    if (res?.content) {
      const parsed = JSON.parse(cleanJson(res.content));
      const validated = ModeDecisionSchema.safeParse({
        ...parsed,
        extractedEntities: {
          ...extractedEntities,
          ...(parsed.extractedEntities || {}),
        },
      });

      if (validated.success) {
        // Chat 模式保护原则：若用户当前在 Chat，且置信度未达到 0.85，不强制切换为 work，而是建议 chat_then_offer_work
        if (
          context?.currentRoute === "chat" &&
          validated.data.route === "work" &&
          validated.data.confidence < 0.85
        ) {
          return {
            ...validated.data,
            route: "chat_then_offer_work",
          };
        }
        return validated.data;
      }
    }
  } catch {
    // LLM 超时或解析异常：平滑回退
  }

  // 4. 容灾兜底判断
  const hasActionVerb = /(?:生成|提交|发布|修改|修复|创建|编写|批量更新)/i.test(
    trimmed,
  );
  const fallbackRoute = hasActionVerb ? "work" : "chat";

  return {
    route: fallbackRoute,
    intent: hasActionVerb ? "action_request" : "information_query",
    goalType: hasActionVerb ? "actionable" : "informational",
    requiresExecution: hasActionVerb,
    confidence: 0.75,
    extractedEntities,
    workSuggestion: hasActionVerb
      ? {
          reason: "检测到明确的任务执行动作动词",
        }
      : undefined,
  };
}
