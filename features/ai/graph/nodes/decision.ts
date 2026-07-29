import type { AgentState } from "../agent";
import type { DisambiguationCandidate } from "../types";
import { searchAmbiguousEntities } from "@/features/ai/core/queries/query-ambiguous";

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

    if (
      decisionField?.type === "human" &&
      decisionField.entityType &&
      decisionField.candidates &&
      decisionField.candidates.length > 0
    ) {
      const entityType = decisionField.entityType;
      console.log(
        `[decision] tool.decision.human entityType=${entityType} candidates=${decisionField.candidates.length} extractedQueryType=${extractedQueryType ?? "none"}`
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

  // ── Branch 2: ambiguous query type — search across entity types ──
  // detectIntent sets state.queryType = "ambiguous" when parseQueryType returns
  // "ambiguous". We only act on it when there's no pendingHumanAction yet
  // (avoid double-triggering) and no resolvedEntities (already picked once).
  if (state.queryType === "ambiguous" && !state.pendingHumanAction && !state.resolvedEntities) {
    const lastMessage = state.messages[state.messages.length - 1];
    const lastMessageContent = typeof lastMessage?.content === "string"
      ? lastMessage.content
      : "";
    const query = state.originalQuery || lastMessageContent;

    if (!query) {
      return {};
    }

    const candidates = await searchAmbiguousEntities(query);

    if (candidates.length > 0) {
      console.log(
        `[decision] ambiguous query candidates=${candidates.length} query="${query.slice(0, 40)}"`
      );
      return {
        pendingHumanAction: {
          type: "select",
          entity: "ambiguous",
          entityType: "ambiguous",
          reason: `查询"${query.slice(0, 30)}"未明确指向某种实体类型，请选择：`,
          candidates: candidates.map((c) => ({
            id: c.id,
            label: c.label,
            summary: c.summary,
          })),
          query,
          sourceResult: { queryType: "ambiguous", originalQuery: query },
        },
        waitingForConfirmation: true,
        originalQuery: query,
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