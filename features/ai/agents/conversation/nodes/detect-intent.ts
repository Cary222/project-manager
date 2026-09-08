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

// ─── Workflow Detection ───────────────────────────────────────────────────────

/**
 * Workflow keyword patterns mapped to workflow types.
 * These are high-confidence triggers that directly match workflow capabilities.
 */
const WORKFLOW_PATTERNS: { pattern: RegExp; workflowType: string; keyword: string; confidence: number }[] = [
  // 周报相关
  {
    pattern: /(?:帮我)?生成(?:本周|这周|上周)?(?:的)?(?:周报|一周(?:工作)?总结)/i,
    workflowType: "weekly_report",
    keyword: "生成周报",
    confidence: 0.95,
  },
  {
    pattern: /(?:帮我)?(?:提交|发布|上交|推送|更新)(?:本周|这周|上周)?(?:的)?(?:周报|一周(?:工作)?总结)/i,
    workflowType: "weekly_report",
    keyword: "提交周报",
    confidence: 0.95,
  },
  {
    pattern: /(?:帮我)?(?:写|写一下|做|做一下)(?:本周|这周|上周)?(?:的)?(?:周报|一周总结)/i,
    workflowType: "weekly_report",
    keyword: "写周报",
    confidence: 0.9,
  },
  {
    pattern: /(?:帮我)?整理(?:本周|这周|上周)?(?:的)?(?:工作(?:内容|总结|汇报)|周报)/i,
    workflowType: "weekly_report",
    keyword: "整理工作内容",
    confidence: 0.85,
  },
  {
    pattern: /(?:帮我)?汇总(?:本周|这周|上周)?(?:的)?(?:进度|工作|周报)/i,
    workflowType: "weekly_report",
    keyword: "汇总进度",
    confidence: 0.8,
  },

  // 项目进展相关
  {
    pattern: /(?:帮我)?(?:查看|汇总|统计|分析|生成|了解)?(?:项目|模块|系统)?(?:的)?(?:进展|进度|大盘|概况|统计)/i,
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
    pattern: /^(?!.*(?:有没有|有什么|说了什么|吗[？?]?$))(?:帮我|请)?(?:整理|生成|做|写|上传|转写|总结).*(?:会议(?:纪要|记录|总结)|周会纪要|录音整理)/i,
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
  /^(?:你好|您好|hi|hello|嗨|嗨你好|你好呀|在吗|在不在|在嘛)\s*[!！.。]*$/i,
  /^(?:再见|拜拜|bye|下次见|回见)\s*[!！.。]*$/i,
  // 简单感谢
  /^(?:谢谢|感谢|多谢|谢啦|谢了|感谢你|谢谢你)\s*[!！.。]*$/i,
  // 简单回应
  /^(?:好的|好的好的|好嘞|收到|了解|明白|嗯|嗯嗯|行|OK|ok|好)$/i,
  // 单字/符号类
  /^[!！.?。~～]{1,3}\s*$/,
  /^(?:👍|😊|😄|🙂|👌|✌️|👏)\s*$/,
  // 问 AI 本身的问题
  /^(?:你是谁|你叫什么|你叫什么名字|你是小星吗|你是谁开发|你是做什么的|你是什么|你是什么模型|你的名字是)\s*[?？]*$/i,
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
  const previous = state.messages.slice(0, -1).filter((message) => message.getType() === "human").at(-1);
  const inherited = typeof previous?.content === "string" ? understandQuery(previous.content).scope : undefined;
  const plan = understandQuery(content, inherited);
  if (state.mode === "web" && plan.scope !== "INTERNAL_ONLY") plan.scope = "WEB_ALLOWED";
  const workflowMatch = await detectWorkflowMatch(content);
  if (workflowMatch) return {
    mode: state.mode, workflowMatch, retrievalPlan: null, waitingForConfirmation: true,
    pendingHumanAction: { type: "approve", entityType: "workflow", reason: `检测到工作流「${workflowMatch.workflow.name}」，是否启动？`, query: content },
    ...detectParserFields(content),
  };
  // Preserve HIL-selected identities, but never manufacture a person from a suffix.
  if (state.resolvedEntities && state.originalQuery) return { retrievalPlan: plan };
  const detected = detectMode(content);
  const explicitInternal = plan.scope === "INTERNAL_ONLY" || plan.intent === "related_knowledge" || plan.intent === "activity";
  const mode = state.mode === "auto" || explicitInternal ? detected : state.mode;
  return {
    mode, workflowMatch: null,
    retrievalPlan: mode === "image" || mode === "video" || mode === "chat" ? null : plan,
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
