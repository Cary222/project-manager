/**
 * Query parser utilities for search-structured.
 * Extracts query type, user identifiers, and time windows from user messages.
 */

import type { ExtractedUser, ActivityWindow } from "@/features/ai/types/structured";

/**
 * Extract a user identifier from the user message so we can resolve names
 * like "cary" / "刘屹鹏" / "jing zhang" to a real user record.
 *
 * Strips activity keywords ("最近在干什么"), punctuation, and stopwords so
 * the remaining token is more likely to be a real user name or email prefix.
 */
export function extractUserIdentifier(content: string): ExtractedUser | undefined {
  const timeAdverbs = [
    "最近", "近期", "这周", "本周", "本周内", "近几天", "这几天", "这阵子",
    "今天", "今天内", "今天呢", "今日", "昨天", "昨日", "前天", "前天呢",
    "上周", "上礼拜", "本周初", "本周末", "这几天", "前几周",
  ];
  const activityVerbs = [
    "在做什么", "在干什么", "在干嘛", "在干啥", "干了什么", "干了啥", "做了什么", "做了啥",
    "干什么", "干嘛", "干啥", "做什么", "开发什么", "工作近况", "工作内容",
    "工作时间", "工作动态", "进展", "进度", "最近动态", "干了啥",
  ];
  const stopPhrases = [
    "这位", "这位同事", "一下", "问下", "帮我", "请", "谢谢", "请问",
    "调出", "列出", "查看", "了解", "想了解", "看看", "翻翻",
  ];
  const excludeWords = [
    "周报", "日报", "月报", "周", "日", "月",
    "工作", "事情", "任务", "项目", "业务", "开发",
    "需求", "文档", "笔记", "内容", "设计", "PRD", "传感器", "硬件", "功能",
    "缺陷", "bug", "问题", "的", "地", "得",
  ];
  // 排除词组（多词组合，需要单独处理）
  const excludePhrases = [
    "有哪些", "有什么", "是哪些", "的周报", "的日报", "的月报",
    "的需求", "的文档", "的笔记", "的内容", "的设计",
    "是什么", "的详情", "的内容是",
    "的工单", "工单有哪些", "有哪些工单", "工单",  // ← 加：避免 "我的工单" 被解析成 "工"
  ];
  const stopRegex = new RegExp(
    `(${timeAdverbs.concat(activityVerbs, stopPhrases).join("|")})`,
    "g",
  );
  // 先处理排除词组（按长度降序排列，避免短词先匹配导致长词组失效）
  const sortedExcludePhrases = [...excludePhrases].sort((a, b) => b.length - a.length);
  const excludePhraseRegex = new RegExp(
    `(${sortedExcludePhrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  const excludeRegex = new RegExp(
    `(${excludeWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );

  // 先剥掉句首的"帮忙查一下"类前缀动词短语，避免它们残留成独立 token
  // 干扰后续多 token 场景下 tokens[0] 的取值（否则会把"帮忙查"误当成用户名）。
  const withoutLeadIn = stripLeadInVerbs(content);

  const cleaned = withoutLeadIn
    .replace(excludePhraseRegex, " ") // 先移除词组
    .replace(stopRegex, " ")
    .replace(excludeRegex, " ")
    .replace(/^(?:用户|成员|同事)\s*/i, "")
    .replace(/[，。！？、,.!?:\s]+/g, " ")
    .trim();

  // Strip possessive marker from "我的" / "我最近的" before self-check
  const stripped = cleaned.replace(/^我的/g, "我").replace(/^我最近的/g, "我最近");

  // === 自我引用处理：用户输入 "我" 或 "我最近的" / "我的" 等 ===
  if (
    stripped === "我" ||
    stripped === "我自己" ||
    stripped === "自己" ||
    stripped === "我的" ||
    stripped === "我最近的" ||
    stripped === "我最近" ||
    stripped.startsWith("我的") ||
    stripped.startsWith("我最近") ||
    (stripped.startsWith("我") && stripped.length <= 5)
  ) {
    return { raw: "我", normalized: "我", isSelf: true };
  }

  if (!cleaned) return undefined;

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (/[A-Za-z]/.test(token)) {
        // 找到英文 token，尝试拼接从该位置开始的连续英文 token
        const englishTokens: string[] = [];
        for (let j = i; j < tokens.length && /[A-Za-z]/.test(tokens[j]); j++) {
          englishTokens.push(tokens[j]);
        }
        const raw = englishTokens.join(" ");
        const normalized = raw.replace(/\s+/g, "").toLowerCase();
        return { raw, normalized: normalized.length >= 2 ? normalized : raw.toLowerCase() };
      }
    }
    const raw = tokens[0];
    return { raw, normalized: raw.toLowerCase() };
  }

  // 剥尾部结构助词"得/了/在/是/和/与"（只剥尾巴，不剥中间），兼容"刘工的周报"这类常见人名输入。
  const structuralParticles = /[的了在是与和]+$/;
  const stripStructuralParticles = (value: string) => {
    const stripped = value.replace(structuralParticles, "");
    return stripped.length >= 2 ? stripped : value;
  };

  // 单 token 或全是中文
  const chinese = cleaned.match(/[\u4e00-\u9fa5]{2,}/g);
  if (chinese && chinese.length > 0) {
    const token = chinese.sort((a, b) => b.length - a.length)[0];
    const raw = stripStructuralParticles(token);
    return { raw, normalized: raw };
  }

  const token = tokens[0] ?? cleaned;
  const raw = stripStructuralParticles(token);
  return { raw, normalized: raw.toLowerCase() };
}

/**
 * Strip common lead-in verb phrases ("帮我", "查一下", "请问" 等) from the
 * start of a message so downstream regexes that greedily capture "1-4 个
 * 汉字 + 工/经理/总" don't swallow the verb into the captured name.
 *
 * e.g. "帮我查一下刘工的工单" → "刘工的工单"（去掉"帮我查一下"后才能正确
 * 匹配出"刘工"，否则贪婪正则会把"查一下刘工"整段当成姓名）。
 */
export function stripLeadInVerbs(content: string): string {
  const leadInPhrases = [
    "帮我", "请帮我", "麻烦帮我", "麻烦", "劳烦", "请问", "请", "谢谢",
    "查一下", "查下", "查查", "查一查", "问一下", "问下", "看一下", "看下",
    "找一下", "找下", "调出", "列出", "查看", "了解一下", "想了解", "看看", "翻翻",
    "帮忙查", "帮忙看", "帮忙找", "帮忙",
    "查", "看", "找", "问", "了解",
    "一下", "一查", "一查一下",
  ];
  // 按长度降序排列，避免短词组先命中导致长词组匹配失败
  const sorted = [...leadInPhrases].sort((a, b) => b.length - a.length);
  const regex = new RegExp(`^(?:${sorted.join("|")})+`, "g");
  return content.replace(regex, "").trim();
}

/**
 * Extract ID from user content.
 * Handles patterns like "#10156", "工单 10156", "ticket #10156"
 */
export function extractId(content: string): string | undefined {
  // Match # followed by digits
  const ticketMatch = content.match(/#(\d+)/);
  if (ticketMatch) return ticketMatch[1];

  // Match 工单号/工单 followed by digits
  const gongdanMatch = content.match(/工单[号]?\s*[:：]?\s*(\d+)/i);
  if (gongdanMatch) return gongdanMatch[1];

  // Match "ticket #123" pattern
  const ticketWordMatch = content.match(/ticket\s*#?(\d+)/i);
  if (ticketWordMatch) return ticketWordMatch[1];

  return undefined;
}

export type QueryType =
  | "ticket"
  | "project"
  | "user"
  | "commit"
  | "weekly_report"
  | "note"
  | "ambiguous";

/**
 * Pick the structured entity type only when the message contains a strong signal.
 */
export function parseQueryType(content: string): QueryType {
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  if (/笔记|note|文档|需求|内容/i.test(content)) return "note";

  if (/^[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}\s*(?:的|最近|在干|干了|做了什么|工|老师|经理|总)/.test(content)) {
    return "user";
  }
  if (
    /(?:帮我|请问|找|查|看)\s*[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,30}/.test(content)
    && !/(?:项目|工单|笔记|周报|文档|需求)/.test(content)
  ) {
    return "user";
  }

  return "ambiguous";
}

/**
 * Detect people-centric activity queries that are best served by structured data.
 */
export function isUserActivityQuery(content: string): boolean {
  const time = "(?:最近|近期|这周|本周|近来|今天|今日|昨天|昨日|前天|上周|上一周|上礼拜|这阵子|近几天|前几天|本月|这个月)";
  const activity = "(?:在做什么|在干什么|在干嘛|在干啥|干嘛|干啥|做了什么|干了什么|做了啥|干了啥|做什么|干什么|开发什么|工作近况|工作内容|工作时间|工作总结|产出|完成(?:了)?什么|完成了哪些|进展|进度|动态)";

  return new RegExp(`${time}.{0,12}${activity}`, "i").test(content)
    || new RegExp(`${activity}.{0,12}${time}`, "i").test(content)
    || /[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}\s*(?:在干嘛|在干啥|在做什么|干嘛|干啥|干了什么|做了啥|做了什么|完成了什么|产出|进展|进度|最近动态)/i.test(content)
    || /(?:上周|本周|最近|昨天|这周).{0,10}(?:干了|做了|完成|产出|开发|工作)/i.test(content);
}

/**
 * Detect content-heavy queries that should use semantic knowledge retrieval.
 */
export function isDeepContentQuery(content: string): boolean {
  return /(?:了解|想了解|详情|详细内容|具体内容|文档|需求文档|设计文档|技术文档|需求说明|PRD|需求内容|笔记|记录|说明|资料|光污染|传感器|硬件|功能设计|接口设计)/i.test(content);
}

/**
 * Detect the activity time window implied by the user message.
 * Returns one of: "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "recent".
 */
export function detectActivityWindow(content: string): ActivityWindow | undefined {
  if (/(上周|上一周|上礼拜)/.test(content)) return "last_week";
  if (/(今天|今日|今早|今晚)/.test(content)) return "today";
  if (/(昨天|昨日)/.test(content)) return "yesterday";
  if (/(前天)/.test(content)) return "yesterday";
  if (/(本周|这周|这礼拜|当前周)/.test(content)) return "this_week";
  if (/(本月|这个月|当月)/.test(content)) return "this_month";
  if (/(最近|近期|近来|这阵子|近几天|前几天)/.test(content)) return "recent";
  return undefined;
}

export interface ResolvedTimeWindow {
  window: ActivityWindow;
  startTime: Date;
  endTime: Date;
  label: string;
}

/**
 * 将自然语言相对时间窗口解析为标准的绝对时间范围（精确到毫秒）
 */
export function resolveTemporalWindow(content: string, now: Date = new Date()): ResolvedTimeWindow | undefined {
  const window = detectActivityWindow(content);
  if (!window) return undefined;

  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (window) {
    case "today": {
      const startTime = new Date(y, m, d, 0, 0, 0, 0);
      const endTime = new Date(y, m, d, 23, 59, 59, 999);
      return { window, startTime, endTime, label: "今天" };
    }
    case "yesterday": {
      const startTime = new Date(y, m, d - 1, 0, 0, 0, 0);
      const endTime = new Date(y, m, d - 1, 23, 59, 59, 999);
      return { window, startTime, endTime, label: "昨天" };
    }
    case "this_week": {
      const day = now.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const startTime = new Date(y, m, d - diffToMonday, 0, 0, 0, 0);
      const endTime = new Date(y, m, d - diffToMonday + 6, 23, 59, 59, 999);
      return { window, startTime, endTime, label: "本周" };
    }
    case "last_week": {
      const day = now.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      const thisMonday = new Date(y, m, d - diffToMonday, 0, 0, 0, 0);
      const startTime = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
      const endTime = new Date(thisMonday.getTime() - 1);
      return { window, startTime, endTime, label: "上周" };
    }
    case "this_month": {
      const startTime = new Date(y, m, 1, 0, 0, 0, 0);
      const nextMonthFirst = new Date(y, m + 1, 1, 0, 0, 0, 0);
      const endTime = new Date(nextMonthFirst.getTime() - 1);
      return { window, startTime, endTime, label: "本月" };
    }
    case "recent": {
      const startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { window, startTime, endTime: new Date(now), label: "近期" };
    }
    default:
      return undefined;
  }
}

/**
 * 识别消息中是否包含对上下文工单/任务的隐式指代
 */
export function isImplicitTicketReference(content: string): boolean {
  const trimmed = content.trim();
  return (
    /(?:这个|该|上个|刚刚的|当前的|上文的)?(?:工单|ticket|任务|缺陷|bug|issue)/i.test(trimmed) ||
    /(?:把|针对|关于|问下|查下)?(?:它|这个|该任务)(?:的|是谁|负责|状态|改|写|修)?/i.test(trimmed)
  );
}
