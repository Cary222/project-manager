import { END } from "@langchain/langgraph";
import type { AgentState } from "../agent";

/** Node names used in the routing graph */
export type NextNode =
  | "searchKnowledge"
  | "searchStructured"
  | "webSearch"
  | "generateResponse"
  | typeof END;

/**
 * Route by mode — conditional edge function.
 *
 * After detectIntent sets state.mode, this function returns
 * the next node name based on the mode.
 *
 * Efficiency-first routing:
 * - search (force deep): always starts with searchKnowledge (RAG)
 *                        → then searchStructured (DB) → generateResponse
 * - auto (intelligent):  content/doc/note queries → searchKnowledge (RAG deep)
 *                        exact IDs / stats / vcs queries → searchStructured (fast DB)
 * - web:  webSearch → generateResponse
 * - chat: generateResponse (no tools)
 */
export function routeByMode(state: AgentState): NextNode {
  const lastMessage = state.messages[state.messages.length - 1];
  const content =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : "";
  console.log(`[routeByMode] state.mode=${state.mode} content="${content.slice(0, 60)}"`);

  switch (state.mode) {
    case "search":
      // 人员近况在 search 模式下也直接走 DB（结构化人员数据更准）。
      if (isUserActivityQuery(content)) return "searchStructured";
      return "searchKnowledge";

    case "auto": {
      const lastMessage = state.messages[state.messages.length - 1];
      const content =
        typeof lastMessage?.content === "string"
          ? lastMessage.content
          : "";
      // 人员近况 → DB 快查
      if (isUserActivityQuery(content)) return "searchStructured";
      // Deep content / document / note queries → RAG for semantic retrieval
      if (isDeepContentQuery(content)) return "searchKnowledge";
      // Everything else (exact IDs, stats, vcs, workflow) → fast DB
      return "searchStructured";
    }

    case "web":
      return "webSearch";

    case "chat":
    default:
      return "generateResponse";
  }
}

/**
 * Route after searchKnowledge → to structured search or directly to response.
 *
 * Always chains to searchStructured so both RAG results and structured DB
 * results are available for the final answer.
 */
export function routeAfterSearchKnowledge(_state: AgentState): NextNode {
  return "searchStructured";
}

/**
 * Route after searchStructured or webSearch → to generateResponse.
 */
export function routeToResponse(_state: AgentState): NextNode {
  return "generateResponse";
}

// ─── Query classification helpers ────────────────────────────────────────────

/**
 * Detects deep content / document / note queries that need RAG.
 * These should trigger searchKnowledge (vector retrieval) in auto mode.
 */
function isDeepContentQuery(content: string): boolean {
  return /(?:了解|想了解|详情|详细内容|具体内容|文档|需求文档|设计文档|技术文档|需求说明|PRD|需求内容|笔记|记录|说明|资料|光污染|传感器|硬件|功能设计|接口设计)/i.test(content);
}

/**
 * Detects people-centric activity queries — "X 最近在干啥 / 本周在做什么".
 * These go to searchStructured (DB) so the agent can resolve user names to IDs
 * and surface weekly reports + recently-updated tickets.
 */
function isUserActivityQuery(content: string): boolean {
  const time = "(?:最近|近期|这周|本周|近来|今天|今日|昨天|昨日|前天|上周|这阵子|近几天|前几天)";
  const activity = "(?:在做什么|在干什么|在干嘛|做了什么|干了什么|做了啥|干了啥|做什么|干什么|开发什么|工作近况|工作内容|工作时间|进展|进度|动态)";
  return new RegExp(`${time}.{0,12}${activity}`, "i").test(content)
    || new RegExp(`${activity}.{0,12}${time}`, "i").test(content)
    || /[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,30}\s*(?:干了什么|做了啥|做了什么|进展|进度|最近动态)/i.test(content);
}
