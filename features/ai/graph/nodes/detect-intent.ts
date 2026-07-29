import type { AgentMode } from "../state";
import type { AgentState } from "../agent";
import {
  parseQueryType,
  extractUserIdentifier,
  detectActivityWindow,
  type QueryType,
} from "@/features/ai/core/resolvers/query-parser";
import type { ExtractedUser, ActivityWindow } from "@/features/ai/types/structured";

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
  /^(?:你是谁|你叫什么|你叫什么名字|你是小星吗|你是谁开发|你是做什么的)\s*[?？]*$/i,
];

function isPureChat(message: string): boolean {
  return PURE_CHAT_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

export function detectMode(message: string): AgentMode {
  const trimmed = message.trim();

  // 1. 天气/实时信息 → web
  const hasWeatherIntent = WEB_KEYWORDS.some(
    ({ pattern, category }) => category === "weather" && pattern.test(trimmed)
  );
  if (hasWeatherIntent) return "web";

  const hasWebIntent = WEB_KEYWORDS.some(
    ({ pattern, category }) => category === "web" && pattern.test(trimmed)
  );
  if (hasWebIntent) return "web";

  // 2. 纯闲聊 → chat
  if (isPureChat(trimmed)) return "chat";

  // 3. 人员近况必须走结构化（优先级高于默认 search）
  if (isUserActivityQuery(trimmed)) return "search";

  // 4. 其他查询 → search（结构化查询）
  if (containsSearchKeywords(trimmed)) return "search";

  // 5. 兜底默认 search（项目管理平台，大部分查询都涉及数据）
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

  // For non-auto mode, just pass through — the mode was set by the API (pending round).
  if (state.mode !== "auto") {
    console.log(`[detectIntent] mode=${state.mode} !== auto, passing through`);
    return { mode: state.mode };
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

  // ── 推断"他/她/这个用户"等代词的上下文 ───────────────────────────────
  // 如果当前消息是纯代词或泛指性问题，从对话历史中推断最近讨论的用户
  // 但如果消息明确包含新用户引用（如"张工"、"李工"），应该更新上下文
  const pronounQuestions = ["他很强吗", "他厉害吗", "他怎么样", "他强吗", "他是谁", "她怎么样", "她厉害吗", "它"];
  const isPronounOnly = content.length < 10 && (
    pronounQuestions.some(p => content.includes(p)) ||
    /^[\u4e00-\u9fa5]{1,4}[?？]?$/.test(content)
  );

  // 检测消息是否明确包含新用户引用（如"张工"、"李工"、"王经理"）
  const explicitUserMatch = content.match(/([\u4e00-\u9fa5]{1,4}(?:工|经理|总|老板|同事))/);
  const hasExplicitUser = !!explicitUserMatch;

  // 如果有明确的新用户引用，更新上下文
  if (hasExplicitUser && explicitUserMatch) {
    const newUserName = explicitUserMatch[1];
    console.log(`[detectIntent] detected explicit user reference: ${newUserName}`);
    return {
      mode: detectMode(content),
      lastMentionedUser: { id: "", name: newUserName },
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
      const workerMatch = msgContent.match(/([\u4e00-\u9fa5]{1,4}工)/);
      if (workerMatch) {
        const mentionedName = workerMatch[1];
        console.log(`[detectIntent] detected worker reference to "${mentionedName}" from history`);
        return {
          mode: detectMode(content),
          lastMentionedUser: { id: "", name: mentionedName },
          ...detectParserFields(content),
        };
      }
    }
  } else if (isPronounOnly && hasGoodContext) {
    console.log(`[detectIntent] keeping existing lastMentionedUser for pronoun: ${existingName}`);
  }

  const mode = detectMode(content);
  console.log(`[detectIntent] detectMode result=${mode}`);

  return {
    mode,
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
} {
  const queryType = parseQueryType(content);
  const extractedUser = extractUserIdentifier(content);
  const activityWindow = detectActivityWindow(content);
  return {
    queryType,
    extractedUser,
    activityWindow,
  };
}
