import { END } from "@langchain/langgraph";
import type { AgentState, NextNode } from "../agent";
import {
  isUserActivityQuery,
  isDeepContentQuery,
} from "@/features/ai/core/resolvers/query-parser";

// Re-export NextNode for external consumers of this module
export type { NextNode } from "../agent";

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

    case "image":
    case "video":
    case "chat":
    default:
      return "generateResponse";
  }
}

export function routeAfterDetectIntent(state: AgentState): NextNode {
  const waiting = state.waitingForConfirmation;
  const mode = state.mode;
  console.log(`[routeAfterDetectIntent] waitingForConfirmation=${waiting} mode=${mode}`);

  // ── Workflow approval: skip humanConfirmationNode (no candidates to pick) ────
  // Workflow match ("帮我生成周报") sets pendingHumanAction.type="approve".
  // Routing to humanConfirmationNode would show "输入无效" because there are no
  // candidates. Instead, go directly to generateResponse (which returns empty text
  // while waiting) and let routeAfterGenerateResponse → END end the turn cleanly.
  // The workflow_match SSE event is sent directly from route.ts.
  if (waiting && state.pendingHumanAction?.type === "approve") {
    console.log(`[routeAfterDetectIntent] workflow approval pending, skipping humanConfirmationNode`);
    return "generateResponse";
  }

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
  // Fallback: ambiguous query with no candidates matched → bail out to
  // generateResponse so the chat layer can answer conversationally instead
  // of returning an empty bubble.
  return "generateResponse";
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
  // Check for decision — but only if the user has not yet picked from a previous round.
  // If resolvedEntities is set, the selection is complete and we should generate
  // the response, NOT route to decision (which would re-trigger HIL).
  const toolResult = state.toolResults?.searchStructured;
  if (toolResult && typeof toolResult === "object" && !state.resolvedEntities) {
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
 *
 * Workflow match priority: if a workflow match is detected, skip the search
 * pipeline and go directly to generateResponse so the frontend can show
 * a confirmation dialog to launch the workflow.
 */
export function routeAfterModelSelect(state: AgentState): NextNode {
  // Always check waitingForConfirmation first (HIL must not be skipped)
  if (state.waitingForConfirmation) {
    return "humanConfirmation";
  }

  // Workflow match detected → go directly to response (frontend will show launch dialog)
  if (state.workflowMatch) {
    console.log(`[routeAfterModelSelect] workflow match detected: ${state.workflowMatch.type}`);
    return "generateResponse";
  }

  const mode = state.mode;

  if (mode === "web") return "webSearch";
  if (mode === "chat") return "generateResponse";
  if (mode === "image") return "generateResponse";
  if (mode === "video") return "generateResponse";
  // search and auto both start with searchKnowledge
  if (mode === "search" || mode === "auto") return "searchKnowledge";

  // Default fallback
  return "generateResponse";
}
