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

  let cleaned = content
    .replace(excludePhraseRegex, " ") // 先移除词组
    .replace(stopRegex, " ")
    .replace(excludeRegex, " ")
    .replace(/^(?:用户|成员|同事)\s*/i, "")
    .replace(/[，。！？、,.!?:\s]+/g, " ")
    .trim();

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
  const time = "(?:最近|近期|这周|本周|近来|今天|今日|昨天|昨日|前天|上周|这阵子|近几天|前几天)";
  const activity = "(?:在做什么|在干什么|在干嘛|在干啥|干嘛|干啥|做了什么|干了什么|做了啥|干了啥|做什么|干什么|开发什么|工作近况|工作内容|工作时间|进展|进度|动态)";

  return new RegExp(`${time}.{0,12}${activity}`, "i").test(content)
    || new RegExp(`${activity}.{0,12}${time}`, "i").test(content)
    || /[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}\s*(?:在干嘛|在干啥|在做什么|干嘛|干啥|干了什么|做了啥|做了什么|进展|进度|最近动态)/i.test(content);
}

/**
 * Detect content-heavy queries that should use semantic knowledge retrieval.
 */
export function isDeepContentQuery(content: string): boolean {
  return /(?:了解|想了解|详情|详细内容|具体内容|文档|需求文档|设计文档|技术文档|需求说明|PRD|需求内容|笔记|记录|说明|资料|光污染|传感器|硬件|功能设计|接口设计)/i.test(content);
}

/**
 * Detect the activity time window implied by the user message.
 * Returns one of: "today" | "yesterday" | "this_week" | "this_month" | "recent".
 * Returning undefined means "no time filter — show all recent activity".
 */
export function detectActivityWindow(content: string): ActivityWindow | undefined {
  if (/(今天|今日|今早|今晩)/.test(content)) return "today";
  if (/(昨天|昨日)/.test(content)) return "yesterday";
  if (/(前天)/.test(content)) return "yesterday";
  if (/(本周|这周|这礼拜)/.test(content)) return "this_week";
  if (/(本月|这个月)/.test(content)) return "this_month";
  if (/(最近|近期|近来|这阵子|近几天|前几天)/.test(content)) return "recent";
  return undefined;
}
