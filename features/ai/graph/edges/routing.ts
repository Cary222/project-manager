import { END } from "@langchain/langgraph";
import type { AgentState } from "../agent";
import {
  isUserActivityQuery,
  isDeepContentQuery,
} from "@/features/ai/core/resolvers/query-parser";

/** Node names used in the routing graph */
export type NextNode =
  | "detectIntent"
  | "modelSelect"
  | "searchKnowledge"
  | "searchStructured"
  | "decision"
  | "webSearch"
  | "generateResponse"
  | "humanConfirmation"
  | typeof END;

/**
 * Route by mode — conditional edge function.
 *
 * After detectIntent sets state.mode, this function returns
 * the next node name based on the mode.
 *
 * Efficiency-first routing:
 * - search (force deep): always starts with searchKnowledge (RAG)
 *                        → then searchStructured (DB) → decision → generateResponse
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

  switch (state.mode) {
    case "search":
      // 人员近况在 search 模式下也直接走 DB（结构化人员数据更准）。
      if (isUserActivityQuery(content)) return "searchStructured";
      return "searchKnowledge";

    case "auto": {
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

export function routeAfterDetectIntent(state: AgentState): NextNode {
  const waiting = state.waitingForConfirmation;
  const mode = state.mode;
  console.log(`[routeAfterDetectIntent] waitingForConfirmation=${waiting} mode=${mode}`);
  // ── Human-in-Loop: always route to humanConfirmation while waiting ──
  if (waiting) {
    return "humanConfirmation";
  }
  return routeByMode(state);
}

/**
 * Route after human confirmation node.
 *
 * Decision logic:
 *   - pendingHumanAction is set → still waiting for valid input → self-loop to humanConfirmation
 *     (invalid selection case: node already appended error message to messages)
 *   - resolvedEntities has any entity → valid selection → "回炉" to decision
 *     to handle the next decision in the chain.
 *     e.g. Round 1 "刘工的周报有哪些" → user picked "1. cary" → decision picks weekly_report
 *     e.g. Round 2 weekly_report pick → searchStructured uses resolved id → generateResponse
 *   - otherwise → END (nothing pending, nothing resolved = end of HIL flow)
 */
export function routeAfterHumanConfirmation(state: AgentState): NextNode {
  if (state.pendingHumanAction) {
    // Invalid selection or still waiting — self-loop to re-prompt.
    // The error message is already in state.messages from the node's return.
    return "humanConfirmation";
  }
  if (state.resolvedEntities?.user ||
      state.resolvedEntities?.project ||
      state.resolvedEntities?.ticket ||
      state.resolvedEntities?.weekly_report) {
    // Valid selection — "回炉" to decision so it can process the next decision
    // (e.g. cross-type search → user picked type → query that type for specific entity).
    return "decision";
  }
  // No pending, no resolution — end the HIL flow.
  return END;
}

/**
 * Route after decision node.
 *
 * - If pendingHumanAction is set → humanConfirmation
 * - If resolvedEntities is set → searchStructured (redo the query with resolved entity)
 * - Otherwise → END
 */
export function routeAfterDecision(state: AgentState): NextNode {
  if (state.pendingHumanAction) {
    return "humanConfirmation";
  }
  if (state.resolvedEntities) {
    return "searchStructured";
  }
  return END;
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
 * Route after searchStructured → to decision, humanConfirmation, or generateResponse.
 *
 * Priority:
 * 1. If decision.type === "human" (too many results, need to pick) → decision.
 *    This fires BEFORE resolvedEntities check so 2nd-round HIL (e.g. weekly_report >= 3)
 *    is handled even when resolvedEntities.user is set from a previous round.
 * 2. If queryType === "ambiguous" and no entity resolved yet → decision.
 *    detectIntent flagged the message as ambiguous; we route to decision so the
 *    Branch 2 cross-type search can fire. Checked BEFORE resolvedEntities because
 *    an ambiguous Round 1 has no resolvedEntities.
 * 3. If resolvedEntities is set (user confirmed something) → generateResponse.
 *    Only skip decision here when there's no pending decision to process.
 * 4. If pendingHumanAction is set (not yet confirmed) → humanConfirmation.
 * 5. Otherwise → generateResponse.
 */
export function routeAfterSearchStructured(state: AgentState): NextNode {
  // Check for decision FIRST — this handles the 2nd HIL round.
  // Even when resolvedEntities.user is set (user picked from Round 1 candidates),
  // we still need to process a new decision (e.g. 4 weekly reports need a 2nd pick).
  const toolResult = state.toolResults?.searchStructured;
  if (toolResult && typeof toolResult === "object") {
    const resultObj = toolResult as Record<string, unknown>;
    const decision = resultObj.decision as { type?: string } | undefined;
    if (decision?.type === "human") {
      return "decision";
    }
  }
  // Ambiguous query type — route to decision so Branch 2 cross-type search runs.
  // Only fire when no entity has been resolved yet (Round 1 ambiguous path).
  if (state.queryType === "ambiguous" && !state.resolvedEntities) {
    return "decision";
  }
  // No pending decision — check resolvedEntities for a confirmed selection.
  if (state.resolvedEntities?.user ||
      state.resolvedEntities?.project ||
      state.resolvedEntities?.ticket ||
      state.resolvedEntities?.weekly_report) {
    return "generateResponse";
  }
  // Still waiting for initial confirmation?
  if (state.pendingHumanAction) {
    return "humanConfirmation";
  }
  return "generateResponse";
}

/**
 * Route after webSearch → to generateResponse.
 */
export function routeToResponse(_state: AgentState): NextNode {
  return "generateResponse";
}

/**
 * Route after generateResponse → END or back to humanConfirmation.
 *
 * Note: waitingForConfirmation state is captured by the API handler via SSE events,
 * and the pending confirmation is stored in memory. The next user message resumes the flow.
 *
 * Edge case: decision node may set a NEW pendingHumanAction after the user has
 * already confirmed the first round of candidates. For example:
 *   1. "刘工的周报有哪些" → decision(user, 2) → humanConfirmation
 *   2. user picks "1" → user confirmed → searchStructured finds 4 weekly reports
 *   3. decision(weekly_report, 4) sets a NEW pendingHumanAction
 *      but generateResponse fires first → routeAfterGenerateResponse was called
 *      and returned END, losing the new pendingHumanAction.
 *
 * Fix: always check pendingHumanAction before returning END. If it's still set,
 * route back to humanConfirmation to present the next round of candidates.
 */
export function routeAfterGenerateResponse(state: AgentState): NextNode {
  if (state.pendingHumanAction) {
    return "humanConfirmation";
  }
  return END;
}

/**
 * Route after modelSelect → to the appropriate node based on mode.
 *
 * This is the new routing entry after modelSelect was inserted between
 * detectIntent and the tool nodes.
 */
export function routeAfterModelSelect(state: AgentState): NextNode {
  // Always check waitingForConfirmation first (HIL must not be skipped)
  if (state.waitingForConfirmation) {
    return "humanConfirmation";
  }

  const mode = state.mode;

  if (mode === "web") return "webSearch";
  if (mode === "chat") return "generateResponse";
  // search and auto both start with searchKnowledge
  if (mode === "search" || mode === "auto") return "searchKnowledge";

  // Default fallback
  return "generateResponse";
}
