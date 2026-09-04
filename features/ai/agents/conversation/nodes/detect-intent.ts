import type { AgentMode } from "../state";
import type { AgentState } from "../agent";
import type { WorkflowMatch } from "../agent";
import {
  parseQueryType,
  extractUserIdentifier,
  detectActivityWindow,
  resolveTemporalWindow,
  extractId,
  isImplicitTicketReference,
  stripLeadInVerbs,
  type QueryType,
  type ResolvedTimeWindow,
} from "@/features/ai/core/resolvers/query-parser";
import type { ExtractedUser, ActivityWindow } from "@/features/ai/types/structured";

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
    pattern: /(?:帮我)?(?:整理|生成|做|写|上传|转写|总结)?(?:本次|上周|这周|周会|例会|项目)?(?:的)?(?:会议(?:纪要|记录|总结)|周会纪要|录音整理)/i,
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

const SEARCH_KEYWORDS: { pattern: RegExp; category: string }[] = [
  // 纯工单号 — #数字 格式（如 #10156）
  {
    pattern: /#\d{3,}/,
    category: "project_id",
  },
  // 需要查项目数据的强意图
  {
    pattern: /(?:工单|ticket|tickets?|issue|issues?)\s*[#：:]\s*\d+/i,
    category: "project_id",
  },
  {
    pattern: /(?:项目|模块|组件|功能)\s*(?:名|名称|是|叫)?\s*[的:]?\s*\S+/i,
    category: "project_name",
  },
  {
    pattern: /(?:帮我)?(?:找|查|搜|检索|调出|列出|查看|了解|想了解|看看|翻翻)/i,
    category: "search_action",
  },

  // 人员近况 / 工作活动查询
  {
    pattern: /(?:最近|近期|这周|本周|近来|今天|昨天|前天|上周|前天|这阵子|近几天|前几天).{0,12}(?:在做什么|在干什么|在干嘛|在干啥|做了什么|干了什么|做什么|干什么|开发什么|工作近况|工作内容|进展|动态|干了啥|工作时间)/i,
    category: "user_activity",
  },
  {
    // 周报内容查询 — 任何含"周报"的人员相关问题必须进结构化
    pattern: /(?:[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}的)?(?:周报|周报内容|周报写了什么|周报有什么|查看周报|看一下周报|读周报)/i,
    category: "user_activity",
  },
  {
    // 工单列表查询 — 任何含"工单"的列表类问题必须进结构化
    pattern: /(?:[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}的)?(?:工单|ticket|tickets?)(?:列表|有哪些|有什么|全部|所有)/i,
    category: "user_activity",
  },
  {
    // 项目列表查询 — "X的项目有哪些/有什么"
    pattern: /(?:[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}的)?(?:项目|modules?|components?)(?:列表|有哪些|有什么|全部|所有)/i,
    category: "user_activity",
  },
  {
    // 提交活动查询 — "刘工最近提交了什么 / 刘工提交了什么 / X的提交记录"
    pattern: /(?:[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60})(?:最近)?(?:提交|commit)(?:了什么|了|了什么|的记录|记录|列表)?/i,
    category: "user_activity",
  },
  {
    // 通用泛化："X的Y有哪些/有什么" — 覆盖 user/ticket/project/weekly_report
    // 的所有人员关联查询，不确定 Y 时也触发 search 走结构化兜底。
    // 匹配：cary的工单有哪些 / 刘工的周报 / 张三的项目有什么 / 帮我找刘工的
    pattern: /(?:(?:帮我|请)?(?:找|查|看看|看看)?)?[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}的(?:工单|ticket|周报|项目|模块|commit|提交|人|成员)/i,
    category: "user_activity",
  },
  {
    pattern: /(?:在做什么|在干什么|在干嘛|在干啥|做了什么|干了什么|做了啥|干了啥|做什么|干什么|开发什么|工作近况|工作内容|工作时间|进展|动态).{0,12}(?:最近|近期|这周|本周|近来|今天|昨天|前天|上周|这阵子|近几天)/i,
    category: "user_activity",
  },
  {
    // “cary 干了什么 / lhy在干嘛” 这类极简问法：人员标识 + 活动问法
    pattern: /[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}\s*(?:在干嘛|在干啥|在做什么|在干什么|干嘛|干啥|干了什么|做了啥|做了什么|进展|进度|最近动态)/i,
    category: "user_activity",
  },
  {
    // "我最近干了什么 / 他最近做了什么" — 代词/简名 + 时间词 + 活动词
    pattern: /^[\u4e00-\u9fa5A-Za-z0-9_.\-]{1,20}\s*(?:最近|近期|这周|本周|近来|今天|昨天|前天|上周|这阵子|近几天)\s*(?:干了|干了什么|做了什么|干了啥|在干|在干什么|在干嘛|在干啥|在做什么|干了些)/i,
    category: "user_activity",
  },
  // 内容/文档/需求类 — 隐含检索意图
  {
    pattern: /(?:详情|详细内容|具体内容|文档|需求文档|设计文档|技术文档|需求说明|PRD|需求内容)/i,
    category: "search_action",
  },
  // 进度 / 统计类
  {
    pattern: /(?:进度|完成率|统计|汇总|总计|排名|排行|未完成|进行中|逾期)/i,
    category: "statistics",
  },
  // 提交 / 分支 / 代码相关
  {
    pattern: /(?:提交|commit|分支|branch|代码审查|pr|pull.request|review)/i,
    category: "vcs",
  },
  // 工作流 / 指派
  {
    pattern: /(?:指派|分配|负责人|owner|审批|审核|task|todo|待办)/i,
    category: "workflow",
  },
];

function containsSearchKeywords(message: string): boolean {
  return SEARCH_KEYWORDS.some(({ pattern }) => pattern.test(message));
}

export function isUserActivityQuery(message: string): boolean {
  return SEARCH_KEYWORDS.some(
    ({ pattern, category }) => category === "user_activity" && pattern.test(message),
  );
}

// 天气/联网关键词
const WEB_KEYWORDS: { pattern: RegExp; category: string }[] = [
  // 天气模式 — 触发 webSearch
  {
    pattern: /(?:天气|气温|温度|下雨|晴|阴|雨|雪|风|空气|污染|PM)/i,
    category: "weather",
  },
  // 联网搜索明确信号
  {
    pattern: /(?:联网|搜索|搜一下|latest|实时|今天新闻|最近新闻)/i,
    category: "web",
  },
];

// 网页爬取意图 — 具体 URL + 想要获取完整内容
const WEB_SCRAPE_PATTERNS: { pattern: RegExp; category: string }[] = [
  // 明确要求爬取/抓取/获取全文
  { pattern: /(?:爬取|抓取|抓站|采集|获取).*(?:页面|网页|文章|内容|文档)/i, category: "scrape" },
  // 全文/完整内容请求（配合 URL）
  { pattern: /(?:全文|完整内容|完整文章|整页|整个页面)/i, category: "scrape" },
  // 具体 URL + 动作词
  { pattern: /https?:\/\/[^\s]+/i, category: "scrape" }, // 需要后续逻辑判断
  // 文档/技术文档/面试题请求
  { pattern: /(?:技术文档|面试题|面经|文档|文章|内容)[:：]\s*https?:\/\//i, category: "scrape" },
  // 爬取这个/那个网页
  { pattern: /(?:爬取?|抓取?|获取|看看|读一下)(?:这个|那个|该|下面)?(?:网页?|页面|文章|链接)/i, category: "scrape" },
  // 帮我读取这个网址
  { pattern: /(?:帮我|请)?(?:读取|获取|爬取|抓取).*(?:网址|链接|url|地址)/i, category: "scrape" },
];

// 检测是否有具体 URL 存在
function containsUrl(message: string): boolean {
  return /https?:\/\/[^\s]+/i.test(message);
}

// 检测是否有爬取意图（需要 URL 存在才触发）
function hasScrapeIntent(message: string): boolean {
  const hasUrl = containsUrl(message);
  const hasScrapeKeyword = WEB_SCRAPE_PATTERNS.some(
    ({ pattern, category }) => category === "scrape" && pattern.test(message)
  );
  // 有 URL 就有潜在爬取可能，或者有明确的爬取关键词
  return hasUrl || hasScrapeKeyword;
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

  // 3. 网页爬取意图（有 URL + 爬取意图）→ web（AI 会自主选择 webSearch 或 webScrape）
  if (hasScrapeIntent(trimmed)) return "web";

  // 4. 天气/联网搜索 → web
  const hasWeatherIntent = WEB_KEYWORDS.some(
    ({ pattern, category }) => category === "weather" && pattern.test(trimmed)
  );
  if (hasWeatherIntent) return "web";

  const hasWebIntent = WEB_KEYWORDS.some(
    ({ pattern, category }) => category === "web" && pattern.test(trimmed)
  );
  if (hasWebIntent) return "web";

  // 5. 纯闲聊 → chat
  if (isPureChat(trimmed)) return "chat";

  // 6. 人员近况必须走结构化（优先级高于默认 search）
  if (isUserActivityQuery(trimmed)) return "search";

  // 7. 其他查询 → search（结构化查询）
  if (containsSearchKeywords(trimmed)) return "search";

  // 8. 兜底默认 search（项目管理平台，大部分查询都涉及数据）
  return "search";
}

/**
 * Detect intent node — migrates logic from features/ai/lib/detector.ts.
 *
 * Reads the last user message, determines the agent mode,
 * and returns a partial state update with the mode.
 */
export async function detectIntent(
  state: AgentState
): Promise<Partial<AgentState>> {
  // ── Human-in-Loop: ALWAYS skip message inspection while waiting ──
  // When waitingForConfirmation=true, route to humanConfirmation regardless of mode.
  // Must be checked FIRST (before mode check) because mode may be "search" (not "auto")
  // in follow-up rounds, and mode !== "auto" would bypass this guard.
  if (state.waitingForConfirmation) {
    console.log(`[detectIntent] waiting for confirmation, skipping intent detection`);
    return {};
  }

  // When resolvedEntities is already set (from a previous humanConfirmation round),
  // skip intent detection entirely. routeAfterDetectIntent → routeByMode will route
  // directly to searchStructured so the confirmed entity is used without re-parsing.
  if (state.resolvedEntities) {
    console.log(`[detectIntent] resolvedEntities already set, skipping intent detection`);
    return {};
  }

  // For non-auto mode, check if the message contains user_activity keywords.
  // If so, override to "search" mode — frontend may send "chat" for casual messages,
  // but "我最近干了什么" should always go through structured search.
  if (state.mode !== "auto") {
    const lastMessage = state.messages[state.messages.length - 1];
    const content = typeof lastMessage?.content === "string"
      ? lastMessage.content.trim()
      : "";

    // ── Workflow Detection (BEFORE force-search override) ────────────────────
    // Workflow match (生成周报 / 提交周报 / 写周报 / 汇总周报) must take priority
    // over the generic user_activity force-search branch below. Otherwise
    // "帮我生成周报" matches isUserActivityQuery via its 周报 keyword and we
    // early-return { mode: "search" } before detectWorkflowMatch runs, so the
    // workflow popup never fires.
    const workflowMatch = await detectWorkflowMatch(content);
    if (workflowMatch) {
      console.log(`[detectIntent] workflow match in non-auto mode: ${workflowMatch.type}`);
      return {
        mode: state.mode,
        workflowMatch,
        waitingForConfirmation: true,
        pendingHumanAction: {
          type: "approve",
          entityType: "workflow",
          reason: `检测到工作流「${workflowMatch.workflow.name}」，是否启动？`,
          query: content,
        },
        ...detectParserFields(content),
      };
    }

    // If it's a user activity query, force search mode
    if (isUserActivityQuery(content)) {
      console.log(`[detectIntent] user activity detected, forcing search mode (was: ${state.mode})`);
      return { mode: "search" };
    }

    console.log(`[detectIntent] mode=${state.mode} !== auto, passing through`);
    return { mode: state.mode, ...detectParserFields(content) };
  }

  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.getType() !== "human") {
    console.log(`[detectIntent] early return: lastMessage missing or not human`);
    return { mode: "chat" };
  }

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content.trim()
      : JSON.stringify(lastMessage.content);

  console.log(`[detectIntent] content="${content}"`);

  // ── 工单指代消解与焦点更新 ──────────────────────────────────────────────
  const explicitTicketId = extractId(content);
  let resolvedTicket: { id: string; ticketNo: number } | null = state.lastMentionedTicket ?? null;
  if (explicitTicketId) {
    const ticketNo = parseInt(explicitTicketId, 10);
    if (!Number.isNaN(ticketNo)) {
      resolvedTicket = { id: "", ticketNo };
    }
  } else if (isImplicitTicketReference(content) && state.lastMentionedTicket) {
    resolvedTicket = state.lastMentionedTicket;
  }
  // ── 推断"他/她/这个用户"等代词的上下文 ───────────────────────────────
  // 如果当前消息是纯代词或泛指性问题，从对话历史中推断最近讨论的用户
  // 但如果消息明确包含新用户引用（如"张工"、"李工"），应该更新上下文
  const pronounQuestions = ["他很强吗", "他厉害吗", "他怎么样", "他强吗", "他是谁", "她怎么样", "她厉害吗", "它"];
  const isPronounOnly = content.length < 10 && (
    pronounQuestions.some(p => content.includes(p)) ||
    /^[\u4e00-\u9fa5]{1,4}[?？]?$/.test(content)
  );

  // 自我引用保护：在检测"张工"/"李工"等显式用户名之前，
  // 排除"我"、"我最近的..."、"我的..."等自我引用输入。
  // 否则"我最近的工"会被正则捕获为"我最近的工"并写入 lastMentionedUser。
  const isSelfReference = /^我/.test(content) && !/^[^我]{2,}工/.test(content);
  if (isSelfReference) {
    // 只返回模式检测，不更新 lastMentionedUser
    return { mode: detectMode(content), lastMentionedTicket: resolvedTicket, ...detectParserFields(content) };
  }

  // 检测消息是否明确包含新用户引用（如"张工"、"李工"、"王经理"）
  // 先剥掉"帮我查一下"等前缀动词短语，再用非贪婪量词匹配，避免把
  // "查一下刘工"整段误当成姓名（贪婪 {1,4} 会尽量往前吃满 4 个汉字）。
  const explicitUserMatch = stripLeadInVerbs(content).match(/([\u4e00-\u9fa5]{1,4}?(?:工|经理|总|老板|同事))/);
  const hasExplicitUser = !!explicitUserMatch;

  // 如果有明确的新用户引用，更新上下文
  if (hasExplicitUser && explicitUserMatch) {
    const newUserName = explicitUserMatch[1];
    console.log(`[detectIntent] detected explicit user reference: ${newUserName}`);
    return {
      mode: detectMode(content),
      lastMentionedUser: { id: "", name: newUserName },
      lastMentionedTicket: resolvedTicket,
      ...detectParserFields(content),
    };
  }

  // 如果 context 已有有效的 lastMentionedUser（长度 > 2 表示是完整用户名），且当前是代词问题，保留上下文
  const existingName = state.lastMentionedUser?.name;
  const hasGoodContext = existingName && existingName.length > 2;

  if (isPronounOnly && state.messages.length > 1 && !hasGoodContext) {
    // 从最近的用户消息中查找人员姓名
    for (let i = state.messages.length - 2; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.getType() !== "human") continue;
      const msgContent = typeof msg.content === "string" ? msg.content : "";

      // 优先匹配"XX工"（如许工、张工、刘工）
      // 同样先剥前缀动词再用非贪婪量词，避免"查一下刘工"误匹配
      const workerMatch = stripLeadInVerbs(msgContent).match(/([\u4e00-\u9fa5]{1,4}?工)/);
      if (workerMatch) {
        const mentionedName = workerMatch[1];
        console.log(`[detectIntent] detected worker reference to "${mentionedName}" from history`);
        return {
          mode: detectMode(content),
          lastMentionedUser: { id: "", name: mentionedName },
          lastMentionedTicket: resolvedTicket,
          ...detectParserFields(content),
        };
    }
        }
  } else if (isPronounOnly && hasGoodContext) {
    console.log(`[detectIntent] keeping existing lastMentionedUser for pronoun: ${existingName}`);
  }

  const mode = detectMode(content);
  console.log(`[detectIntent] detectMode result=${mode}`);

  // ── 工作流检测 ───────────────────────────────────────────────────────────────
  // 在返回之前检测是否匹配工作流
  const workflowMatch = await detectWorkflowMatch(content);

  if (workflowMatch) {
    console.log(`[detectIntent] workflow match in auto mode: ${workflowMatch.type}`);
    return {
      mode,
      workflowMatch,
      waitingForConfirmation: true,
      pendingHumanAction: {
        type: "approve",
        entityType: "workflow",
        reason: `检测到工作流「${workflowMatch.workflow.name}」，是否启动？`,
        query: content,
      },
      lastMentionedTicket: resolvedTicket,
      ...detectParserFields(content),
    };
  }

  return {
    mode,
    workflowMatch,
    lastMentionedTicket: resolvedTicket,
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
