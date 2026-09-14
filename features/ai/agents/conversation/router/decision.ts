/**
 * Chat Decision Service —— AiChat 服务端轻量级语义决策器。
 *
 * 对应架构设计: AiChat Answer Runtime - decideChatRoute (LLM决策)
 *
 * 职责：
 * 彻底终结用死板正则表达式硬猜用户意图的做法。
 * 1. 纯闲聊/问候/图片视频生成走 0ms 快路径，不浪费 token 与延迟；
 * 2. 其余业务/问答请求交由轻量 Flash 模型在极短延迟内（<1.5s）完成语义判决：
 *    - "chat" (direct): 闲聊、问 AI 自身能力、打招呼
 *    - "search" (retrieve/structured/mixed): 内部项目/工单/人员/代码/知识库检索
 *    - "workflow" (work): 明确触发预设固定工作流（周报、项目大盘、会议纪要）
 *    - "web": 外部互联网信息/天气/通用开放知识
 * 3. 结构化实体声明：声明需要的实体（user/ticket/project），下游由 Passive Grounding 负责对齐，不主动乱猜；
 * 4. 故障容灾：LLM 超时或异常时自动降级到规则启发式，绝不阻断用户会话。
 */

import { callAgnes } from "@/features/ai/llm/summarizer";
import type { AgentMode } from "../state";
import { understandQuery } from "@/features/ai/search/query-understanding";
import { extractExplicitMentions } from "@/features/ai/core/context/context-resolver";
import type { DeclaredEntity } from "@/features/ai/core/entities/grounding";

export type ChatExecutionMode =
  | "direct"
  | "retrieve"
  | "structured"
  | "mixed"
  | "work";

export interface ChatRouteDecision {
  mode: AgentMode | "workflow";
  executionMode: ChatExecutionMode;
  intent: string;
  workflowType?: string;
  requiredCapabilities: string[];
  requiredEntities: DeclaredEntity[];
  confidence: number;
  reason?: string;
}

const FAST_CHAT_REGEX =
  /^(?:你好|您好|hi|hello|嗨|嗨你好|你好呀|在吗|在不在|在嘛|哈喽|早上好|下午好|晚上好|谢谢|谢谢你|多谢|感谢|好的|好的好的|好嘞|收到|明白|再见|拜拜)\s*[!！.?。~～]*$/i;

const FAST_IDENTITY_REGEX =
  /^(?:你是谁|你叫什么|你叫什么名字|你是小星吗|你是谁开发|你是做什么的|你是什么|你是什么模型|介绍一下你自己|你能做(?:什么|哪些|点啥)|你有什么功能|你可以帮我做什么|你能帮我做什么|使用说明|功能列表|怎么使用|怎么用)\s*[?？!！.。]*$/i;

const FAST_IMAGE_REGEX = /(?:生成|画|创作|制作|做).*(?:图片?|图|画像|照片)/i;
const FAST_VIDEO_REGEX = /(?:生成|制作|创作|做).*(?:视频?|短片|动画|影片)/i;

const SYSTEM_PROMPT = `你是对话意图与能力规划分类器。将用户消息严格分类为以下模式之一：
- "chat": 闲聊、问候、问AI功能与能力、情绪互动（executionMode="direct"）
- "search": 查询公司内部项目、工单、任务、人员近况、周报、Git提交、技术文档、项目知识库（executionMode="retrieve"|"structured"|"mixed"）
- "workflow": 用户明确要求生成周报(weekly_report)、汇总项目进展大盘(project_progress)、整理会议纪要(meeting_minutes)（executionMode="work"）
- "web": 询问外部互联网实时天气、新闻、公开技术常识（executionMode="retrieve"）

直接输出严格 JSON（不要代码块，不要解释）：
{"mode": "chat|search|workflow|web", "executionMode": "direct|retrieve|structured|mixed|work", "workflowType": "weekly_report|project_progress|meeting_minutes|null", "intent": "简短意图标签", "entities": [{"type": "user|project|ticket", "value": "被提到的实体词", "required": true}], "confidence": 0.0到1.0}`;

/**
 * 轻量语义路由决策主入口
 */
export async function decideChatRoute(
  content: string,
  options?: { userId?: string; timeoutMs?: number },
): Promise<ChatRouteDecision> {
  const trimmed = content.trim();

  // 1. 0ms 快路径：纯问候与自我介绍
  if (FAST_CHAT_REGEX.test(trimmed) || FAST_IDENTITY_REGEX.test(trimmed)) {
    return {
      mode: "chat",
      executionMode: "direct",
      intent: "greeting_or_meta",
      requiredCapabilities: [],
      requiredEntities: [],
      confidence: 1.0,
      reason: "快路径命中日常问候或 AI 功能咨询",
    };
  }

  // 2. 0ms 快路径：显式多媒体意图
  if (FAST_IMAGE_REGEX.test(trimmed)) {
    return {
      mode: "image",
      executionMode: "direct",
      intent: "image_generation",
      requiredCapabilities: ["image.generate"],
      requiredEntities: [],
      confidence: 0.95,
      reason: "快路径命中图片生成需求",
    };
  }
  if (FAST_VIDEO_REGEX.test(trimmed)) {
    return {
      mode: "video",
      executionMode: "direct",
      intent: "video_generation",
      requiredCapabilities: ["video.generate"],
      requiredEntities: [],
      confidence: 0.95,
      reason: "快路径命中视频生成需求",
    };
  }

  // 提取显式标记作为硬事实 (@user, #ticket)
  const explicit = extractExplicitMentions(trimmed);
  const explicitEntities: DeclaredEntity[] = [
    ...explicit.ticketNumbers.map((no) => ({
      type: "ticket" as const,
      value: String(no),
      required: true,
    })),
    ...explicit.userMentions.map((name) => ({
      type: "user" as const,
      value: name,
      required: true,
    })),
  ];

  // 3. 大模型语义决策（Flash 微型模型，极简 Prompt，短超时）
  const timeoutMs = options?.timeoutMs ?? 1500;

  try {
    const res = await Promise.race([
      callAgnes(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: trimmed },
        ],
        { userId: options?.userId, preferredModelRef: "agnes:agnes-2.0-flash" },
      ),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("ChatRoute timeout")), timeoutMs),
      ),
    ]);

    if (res?.content) {
      const cleaned = res.content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
      const parsed = JSON.parse(cleaned) as {
        mode?: string;
        executionMode?: string;
        workflowType?: string | null;
        intent?: string;
        entities?: Array<{ type?: string; value?: string; required?: boolean }>;
        confidence?: number;
      };

      if (
        parsed.mode &&
        ["chat", "search", "workflow", "web"].includes(parsed.mode)
      ) {
        const declaredEntities: DeclaredEntity[] = [
          ...explicitEntities,
          ...(Array.isArray(parsed.entities)
            ? parsed.entities
                .filter((e) => e.type && e.value)
                .map((e) => ({
                  type: e.type as DeclaredEntity["type"],
                  value: e.value!,
                  required: e.required ?? true,
                }))
            : []),
        ];

        return {
          mode: parsed.mode as AgentMode | "workflow",
          executionMode:
            (parsed.executionMode as ChatExecutionMode) ||
            (parsed.mode === "chat" ? "direct" : "mixed"),
          intent: parsed.intent || parsed.mode,
          workflowType: parsed.workflowType || undefined,
          requiredCapabilities:
            parsed.mode === "search"
              ? ["knowledge.search", "business_query"]
              : [],
          requiredEntities: declaredEntities,
          confidence:
            typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
          reason: "LLM 语义分类与实体声明决策",
        };
      }
    }
  } catch {
    // 降级保护：LLM 调用失败或超时时不报错，落入下方的语义计划启发式
  }

  // 4. 容灾兜底：基于 understandQuery 规则提取
  const plan = understandQuery(trimmed);
  const fallbackMode: AgentMode =
    plan.scope === "WEB_ALLOWED" && plan.intent === "external"
      ? "web"
      : "search";

  return {
    mode: fallbackMode,
    executionMode: fallbackMode === "web" ? "retrieve" : "mixed",
    intent: plan.intent,
    requiredCapabilities:
      fallbackMode === "web" ? ["web.search"] : ["knowledge.search"],
    requiredEntities: explicitEntities,
    confidence: 0.7,
    reason: "降级走启发式检索意图规则",
  };
}
