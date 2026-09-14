import type { AgentState } from "../agent";
import type { DisambiguationCandidate } from "../types";
import { COMMON_NON_NAMES, isUserActivityQuery } from "@/features/ai/core/resolvers/query-parser";

/**
 * Decision node — unified decision layer after searchStructured.
 *
 * Single responsibility: read tool result / ambiguous state and translate
 * it into a `pendingHumanAction`. The graph only checks `if (decision)`.
 *
 * Design rules:
 * - Decision logic lives in the Tool, not the Graph.
 * - Graph only checks `if (result.decision)`.
 * - This node does NOT parse attribution or maintain thresholds.
 *
 * Renamed from disambiguateIntentNode to decisionNode (F2).
 * Exports the new name `decision` and keeps `disambiguateIntentNode`
 * for backwards compatibility with anything that hasn't migrated yet.
 */
export async function disambiguateIntentNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const toolResult = state.toolResults?.searchStructured;

  // ── Branch 1: explicit tool decision (searchStructured returned candidates) ──
  if (toolResult && typeof toolResult === "object") {
    const resultObj = toolResult as Record<string, unknown>;
    const decisionField = resultObj.decision as {
      type?: string;
      entityType?: string;
      candidates?: DisambiguationCandidate[];
      reason?: string;
      query?: string;
    } | undefined;

    // Extract queryType from tool result so we can carry it through the HIL pipeline.
    // When the user selects a candidate, searchStructuredNode needs to know the
    // original query type (e.g. "weekly_report" for "刘工的周报有哪些") to redo the
    // query with the resolved user, not re-parse the user's selection ("1" → type=user).
    const structuredResult = state.toolResults?.searchStructured as {
      queryType?: string;
      [key: string]: unknown;
    } | undefined;
    const extractedQueryType = structuredResult?.queryType;

    const lastMessage = state.messages[state.messages.length - 1];
    const content = typeof lastMessage?.content === "string"
      ? lastMessage.content
      : "";

    const isNonNameQuery =
      COMMON_NON_NAMES.has(content.trim()) ||
      (decisionField?.query && COMMON_NON_NAMES.has(decisionField.query.trim()));

    const candidates = decisionField?.candidates ?? [];
    const isTaskBlocking = Boolean(
      state.queryType === "user" ||
      isUserActivityQuery(content) ||
      state.queryType === "weekly_report"
    );

    // 1. 如果仅有 1 个候选，自动对齐采信，绝不弹窗打扰用户
    if (
      decisionField?.type === "human" &&
      decisionField.entityType === "user" &&
      candidates.length === 1 &&
      !state.resolvedEntities
    ) {
      return {
        resolvedEntities: {
          user: { id: candidates[0].id, name: candidates[0].label, resolvedBy: "auto" },
          originalQueryType: (extractedQueryType as "user" | "project" | "ticket" | "commit" | "meeting" | "weekly_report") || "user",
        },
      };
    }

    // 2. 只有在任务被强阻塞且候选数适中(2~6)时才触发 HIL（Search Ambiguity != Human Interaction）
    if (
      decisionField?.type === "human" &&
      state.mode !== "chat" &&
      !isNonNameQuery &&
      !state.resolvedEntities &&
      decisionField.entityType === "user" &&
      isTaskBlocking &&
      candidates.length >= 2 &&
      candidates.length <= 6
    ) {
      const entityType = decisionField.entityType;
      console.log(
        `[decision] tool.decision.human entityType=${entityType} candidates=${candidates.length} extractedQueryType=${extractedQueryType ?? "none"}`
      );
      return {
        pendingHumanAction: {
          type: "select",
          entity: entityType,
          entityType,
          reason: decisionField.reason,
          candidates: decisionField.candidates,
          // 存原始查询，不要用 content（content 可能是用户回复"1"/"3"，不是原始问题）
          query: decisionField.query ?? state.originalQuery,
          // Carry queryType so the next round (after human selects) can redo the query
          // with the resolved entity, using the correct type.
          sourceResult: { queryType: extractedQueryType },
        },
        waitingForConfirmation: true,
        originalQuery: content,
      };
    }
  }


  return {};
}

/**
 * New canonical name for the node. F3 (agent.ts) will register this
 * under the node label `"decision"` when routing is migrated.
 */
export const decision = disambiguateIntentNode;

/**
 * Re-export humanConfirmationNode so agent.ts can import both nodes
 * from this single module. agent.ts uses `humanConfirmation as humanConfirmationNode`.
 */
export { humanConfirmationNode as humanConfirmation } from "./human-confirmation";