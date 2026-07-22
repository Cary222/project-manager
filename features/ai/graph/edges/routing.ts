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
      return "searchKnowledge";

    case "auto": {
      const lastMessage = state.messages[state.messages.length - 1];
      const content =
        typeof lastMessage?.content === "string"
          ? lastMessage.content
          : "";
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
