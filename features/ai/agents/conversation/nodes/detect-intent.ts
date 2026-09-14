import type { AgentMode } from "../state";
import type { AgentState } from "../agent";
import type { WorkflowMatch } from "../agent";
import {
  parseQueryType,
  extractUserIdentifier,
  detectActivityWindow,
  resolveTemporalWindow,
  type QueryType,
  type ResolvedTimeWindow,
} from "@/features/ai/core/resolvers/query-parser";
import type { ExtractedUser, ActivityWindow } from "@/features/ai/types/structured";
import { understandQuery } from "@/features/ai/search/query-understanding";
import { callAgnes } from "@/features/ai/llm/summarizer";
import { decideChatRoute } from "../router/decision";

// ─── Workflow Detection ───────────────────────────────────────────────────────

/**
 * Workflow keyword patterns mapped to workflow types.
 * These are high-confidence triggers that directly match workflow capabilities.
 */
const WORKFLOW_PATTERNS: { pattern: RegExp; workflowType: string; keyword: string; confidence: number }[] = [
  // 周报相关
  {
    pattern: /(?:帮我|我要|我想|给我|请帮我|请)?(?:生成|输出|创建)(?:本周|这周|上周)?(?:的)?(?:周报|一周(?:工作)?总结)/i,
    workflowType: "weekly_report",
    keyword: "生成周报",
    confidence: 0.95,
  },
  {
    pattern: /(?:帮我|我要|我想|给我|请帮我|请)?(?:提交|发布|上交|推送|更新)(?:本周|这周|上周)?(?:的)?(?:周报|一周(?:工作)?总结)/i,
    workflowType: "weekly_report",
    keyword: "提交周报",
    confidence: 0.95,
  },
  {
    pattern: /(?:帮我|我要|我想|给我|请帮我|请)?(?:写|写一下|做|做一下)(?:本周|这周|上周)?(?:的)?(?:周报|一周总结)/i,
    workflowType: "weekly_report",
    keyword: "写周报",
    confidence: 0.9,
  },
  {
    pattern: /(?:帮我|我要|我想|给我|请帮我|请)?整理(?:本周|这周|上周)?(?:的)?(?:工作(?:内容|总结|汇报)|周报)/i,
    workflowType: "weekly_report",
    keyword: "整理工作内容",
    confidence: 0.85,
  },
  {
    pattern: /(?:帮我|我要|我想|给我|请帮我|请)?汇总(?:本周|这周|上周)?(?:的)?(?:进度|工作|周报)/i,
    workflowType: "weekly_report",
    keyword: "汇总进度",
    confidence: 0.8,
  },

  // 项目进展相关
  {
    pattern: /(?:帮我|我要|我想|给我|请帮我|请)?(?:查看|汇总|统计|分析|生成|了解)?(?:项目|模块|系统)?(?:的)?(?:进展|进度|大盘|概况|统计)/i,
    workflowType: "project_progress",
    keyword: "项目进展汇总",
    confidence: 0.9,
  },
  {
    pattern: /(?:项目|模块)(?:当前)?(?:有什么|的)?(?:最新进展|活跃工单|进度如何)/i,
    workflowType: "project_progress",
    keyword: "项目最新进展",
    confidence: 0.85,
  },

  // 会议纪要相关
  {
    pattern: /^(?!.*(?:有没有|有什么|说了什么|吗[？?]?$))(?:帮我|我要|我想|给我|请帮我|请)?(?:记录|录入|整理|生成|做|写|上传|转写|总结).*(?:会议(?:纪要|记录|总结)|周会纪要|录音整理)/i,
    workflowType: "meeting_minutes",
    keyword: "整理会议纪要",
    confidence: 0.9,
  },
  {
    pattern: /(?:录音|语音|音频)(?:文件)?(?:转写|提炼|生成纪要)/i,
    workflowType: "meeting_minutes",
    keyword: "会议录音转写",
    confidence: 0.85,
  },

  // Coding 任务开发相关
  {
    pattern: /(?:针对|根据)?工单\s*#?\d+\s*(?:编写|开发|修复|改代码|实现)/i,
    workflowType: "coding",
    keyword: "工单开发任务",
    confidence: 0.95,
  },
  {
    pattern: /(?:帮我)?(?:修|修复|解决)(?:这个)?(?:bug|缺陷|报错|线上问题)|(?:编写|实现|开发|重构)(?:一个)?.*?(?:功能|代码|模块|接口|页面)/i,
    workflowType: "coding",
    keyword: "Coding代码任务",
    confidence: 0.85,
  },
];
// Cached workflow registry lookup (populated on first match detection)
type CachedWorkflow = { type: string; name: string; description: string };
let _cachedWorkflows: CachedWorkflow[] | null = null;

async function getWorkflows(): Promise<CachedWorkflow[]> {
  if (_cachedWorkflows) return _cachedWorkflows;

  try {
    const { listWorkflows } = await import("@/features/ai/agents/work/workflows/registry");
    const workflows = listWorkflows();
    _cachedWorkflows = workflows.map((w: { type: string; name: string; description: string }) => ({
      type: w.type,
      name: w.name,
      description: w.description,
    }));
  } catch {
    _cachedWorkflows = [];
  }

  return _cachedWorkflows;
}

/**
 * Detect if user query matches any workflow patterns.
 * Returns the highest confidence match or null.
 */
export async function detectWorkflowMatch(message: string): Promise<WorkflowMatch | null> {
  const trimmed = message.trim();

  // First pass: find matching patterns
  let matchedPattern: { workflowType: string; keyword: string; confidence: number } | null = null;
  for (const { pattern, workflowType, keyword, confidence } of WORKFLOW_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (!matchedPattern || confidence > matchedPattern.confidence) {
        matchedPattern = { workflowType, keyword, confidence };
      }
    }
  }

  // Second pass: LLM semantic fallback only for actionable command-like requests
  // (avoid burning latency/API tokens on general questions, facts, or casual chat)
  const isActionableRequest =
    /(?:帮我|请帮|请|我要|我想|想要|需要|打算|计划|协助|可否|能否|可以帮).*(?:做|搞|写|整理|弄|汇总|统计|分析|生成|建|发|出|转|交|提交|记录|录入)/i.test(trimmed) ||
    /(?:周报|总结|进展|进度|大盘|纪要|录音|转写).*(?:做|搞|写|整理|弄|汇总|统计|分析|生成|建|发|出|交|提交|记录|录入)/i.test(trimmed) ||
    /(?:做|搞|写|整理|弄|汇总|统计|分析|生成|建|发|出|交|提交|记录|录入).*(?:周报|总结|进展|进度|大盘|纪要)/i.test(trimmed);

  if (!matchedPattern && isActionableRequest && trimmed.length >= 6 && !isPureChat(trimmed)) {
    try {
      const workflows = await getWorkflows();
      if (workflows.length > 0) {
        const workflowList = workflows
          .map((w) => `- ${w.type}: ${w.name}（${w.description}）`)
          .join("\n");
        const res = await Promise.race([
          callAgnes([
            {
              role: "system",
              content: `判断用户是否想启动某个预设工作流。可用工作流：\n${workflowList}\n仅当用户意图明确匹配某个工作流的核心任务时返回 JSON：{"workflowType": "string", "confidence": number, "keyword": "string"}，否则返回 {"workflowType": null}。不要返回代码块。`,
            },
            { role: "user", content: trimmed },
          ]),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
        if (res && res.content) {
          const cleaned = res.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          const parsed = JSON.parse(cleaned);
          if (parsed.workflowType && parsed.confidence >= 0.8) {
            const found = workflows.find((w) => w.type === parsed.workflowType);
            if (found) {
              return {
                type: parsed.workflowType,
                workflow: found as unknown as WorkflowMatch["workflow"],
                confidence: Math.min(parsed.confidence, 0.95),
                matchedKeyword: parsed.keyword || found.name,
              };
            }
          }
        }
      }
    } catch {
      // LLM fallback timeout or error — silently continue
    }
  }

  if (!matchedPattern) return null;
  // Second pass: look up workflow metadata
  const workflows = await getWorkflows();
  const workflow = workflows.find((w) => w.type === matchedPattern!.workflowType);

  if (!workflow) return null;

  return {
    type: matchedPattern.workflowType,
    // SAFETY: Cached workflow metadata conforms to WorkflowMatch workflow property shape
    workflow: workflow as unknown as WorkflowMatch["workflow"],
    confidence: matchedPattern.confidence,
    matchedKeyword: matchedPattern.keyword,
  };
}

export function isUserActivityQuery(message: string): boolean {
  return understandQuery(message).intent === "activity";
}

// 纯闲聊信号 — 明确不需要查询项目数据
const PURE_CHAT_PATTERNS: RegExp[] = [
  // 简单问候/告别
  /^(?:你好|您好|hi|hello|嗨|嗨你好|你好呀|在吗|在不在|在嘛|哈喽|早上好|下午好|晚上好)\s*[!！.。~～]*$/i,
  /^(?:再见|拜拜|bye|下次见|回见)\s*[!！.。]*$/i,
  // 简单感谢
  /^(?:谢谢|感谢|多谢|谢啦|谢了|感谢你|谢谢你)\s*[!！.。]*$/i,
  // 简单回应
  /^(?:好的|好的好的|好嘞|收到|了解|明白|嗯|嗯嗯|行|OK|ok|好)\s*[!！.。]*$/i,
  // 单字/符号类
  /^[!！.?。~～]{1,3}\s*$/,
  /^(?:👍|😊|😄|🙂|👌|✌️|👏)\s*$/,
  // 问 AI 本身的问题或功能介绍
  /^(?:你是谁|你叫什么|你叫什么名字|你是小星吗|你是谁开发|你是做什么的|你是什么|你是什么模型|你的名字是)\s*[?？]*$/i,
  /^(?:介绍一下你自己|你能做(?:什么|哪些|点啥)|你有什么功能|你可以帮我做什么|你能帮我做什么|使用说明|功能列表|怎么使用|怎么用|你能帮我做些什么)\s*[?？!！.。]*$/i,
  /^(?:你好|您好|hi|hello|嗨|哈喽)[，, ]*(?:请问|在吗|在不在|介绍一下你自己|你能做什么|你有什么功能|可以帮我做什么)\s*[?？!！.。]*$/i,
];

function isPureChat(message: string): boolean {
  return PURE_CHAT_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

export function detectMode(message: string): AgentMode {
  const trimmed = message.trim();

  // 1. 图片生成意图 → image
  const hasImageIntent = /(?:生成|画|创作|制作)(?:一张|一幅|一张)?[的]?(?:.+?)?(?:图片?|图|画像|照片)/i.test(trimmed) ||
    /(?:图片?|图|照片|画像)[:：]/.test(trimmed) ||
    /(?:给我|帮我)?(?:生成|画|创作|做)(?:一张|一幅)?(?:的)?(?:图片?|图|画像|照片)/i.test(trimmed);
  if (hasImageIntent) return "image";

  // 2. 视频生成意图 → video
  const hasVideoIntent = /(?:生成|制作|创作)(?:一个?|段?)?(?:视频?|短片|动画|影片)/i.test(trimmed) ||
    /(?:视频?|短片|动画|影片)[:：]/.test(trimmed) ||
    /(?:帮我|请)?(?:生成|制作)(?:一个?|段?)?/i.test(trimmed) && /(?:视频?|短片|动画|影片)/i.test(trimmed);
  if (hasVideoIntent) return "video";

  if (isPureChat(trimmed)) return "chat";
  const plan = understandQuery(trimmed);
  return plan.scope === "WEB_ALLOWED" && plan.intent === "external" ? "web" : "search";
}

/**
 * Detect intent node — migrates logic from features/ai/lib/detector.ts.
 *
 * Reads the last user message, determines the agent mode,
 * and returns a partial state update with the mode.
 */
export async function detectIntent(state: AgentState): Promise<Partial<AgentState>> {
  if (state.waitingForConfirmation) return {};
  const last = state.messages.at(-1);
  const content = state.originalQuery || (typeof last?.content === "string" ? last.content.trim() : "");
  if (!content) return { mode: state.mode, retrievalPlan: null };
  // 1. 服务端轻量语义决策器接管路由判断（彻底收敛入口）
  const chatRoute = await decideChatRoute(content, { userId: state.userId });

  // 纯闲聊 / 功能咨询直通：被动化，绝不提取人名实体，不触发检索规划
  if (chatRoute.mode === "chat") {
    return {
      mode: "chat",
      workflowMatch: null,
      retrievalPlan: null,
      queryType: "ambiguous",
      extractedUser: undefined,
      activityWindow: undefined,
      resolvedTimeWindow: undefined,
    };
  }

  // 多媒体生成直通
  if (chatRoute.mode === "image" || chatRoute.mode === "video") {
    return {
      mode: chatRoute.mode,
      workflowMatch: null,
      retrievalPlan: null,
      queryType: "ambiguous",
      extractedUser: undefined,
      activityWindow: undefined,
      resolvedTimeWindow: undefined,
    };
  }


  // 3. 工作流意图识别（非侵入式：不打断会话图，在对话结尾通过 SuggestedAction 提供平滑切入）
  let workflowMatch: WorkflowMatch | null = null;
  if (chatRoute.mode === "workflow" && chatRoute.workflowType) {
    const workflows = await getWorkflows();
    const workflow = workflows.find((w) => w.type === chatRoute.workflowType);
    if (workflow) {
      workflowMatch = {
        type: workflow.type,
        workflow: workflow as unknown as WorkflowMatch["workflow"],
        confidence: chatRoute.confidence || 0.9,
        matchedKeyword: workflow.name,
      };
    }
  }

  if (!workflowMatch) {
    workflowMatch = await detectWorkflowMatch(content);
  }

  const previous = state.messages.slice(0, -1).filter((message) => message.getType() === "human").at(-1);
  const inherited = typeof previous?.content === "string" ? understandQuery(previous.content).scope : undefined;
  const plan = understandQuery(content, inherited);
  if ((state.mode === "web" || chatRoute.mode === "web") && plan.scope !== "INTERNAL_ONLY") {
    plan.scope = "WEB_ALLOWED";
  }

  // Preserve HIL-selected identities, but never manufacture a person from a suffix.
  if (state.resolvedEntities && state.originalQuery) return { retrievalPlan: plan, workflowMatch };

  const explicitInternal = plan.scope === "INTERNAL_ONLY" || plan.intent === "related_knowledge" || plan.intent === "activity";
  const targetMode: AgentMode = chatRoute.mode === "workflow" ? "auto" : chatRoute.mode;
  const mode = state.mode === "auto" || explicitInternal ? targetMode : state.mode;

  return {
    mode,
    workflowMatch,
    retrievalPlan: plan,
    lastMentionedUser: state.lastMentionedUser ?? null,
    lastMentionedTicket: plan.entityHints.ticketNo
      ? { id: "", ticketNo: plan.entityHints.ticketNo } : state.lastMentionedTicket ?? null,
    ...detectParserFields(content),
  };
}

/**
 * Parse structured-query fields from the user message so downstream
 * nodes (searchStructured, decision) can read them from state instead of
 * re-parsing the content. Ambiguous classification is carried via
 * `queryType === "ambiguous"` (see `QueryType` union) — no separate flag.
 */
function detectParserFields(content: string): {
  queryType: QueryType;
  extractedUser: ExtractedUser | undefined;
  activityWindow: ActivityWindow | undefined;
  resolvedTimeWindow: ResolvedTimeWindow | undefined;
} {
  const queryType = parseQueryType(content);
  const extractedUser = extractUserIdentifier(content);
  const resolvedTimeWindow = resolveTemporalWindow(content);
  const activityWindow = resolvedTimeWindow?.window ?? detectActivityWindow(content);
  return {
    queryType,
    extractedUser,
    activityWindow,
    resolvedTimeWindow,
  };
}
