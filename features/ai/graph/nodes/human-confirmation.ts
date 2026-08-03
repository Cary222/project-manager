import type { AgentState } from "../agent";
import type { DisambiguationCandidate } from "../types";
import { AIMessage } from "@langchain/core/messages";

/**
 * Parse user's selection from the last message.
 * Works for any entity type — label matching covers user name/email, ticket title, project name, etc.
 *
 * Supports:
 * - Numeric selection: "1", "2", "3"
 * - Label-based selection: matches against DisambiguationCandidate.label
 * - Skip/cancel: "0", "skip", "取消", "cancel"
 */
function parseSelection(
  userInput: string,
  candidates: DisambiguationCandidate[]
): string | null | "skip" {
  const trimmed = userInput.trim();

  // 0. Skip / cancel keywords
  const skipKeywords = ["0", "skip", "取消", "cancel"];
  if (skipKeywords.includes(trimmed.toLowerCase())) {
    return "skip";
  }

  // 1. Try numeric selection (e.g., "1", "2")
  const numericMatch = trimmed.match(/^(\d+)$/);
  if (numericMatch) {
    const index = parseInt(numericMatch[1], 10) - 1;
    if (index >= 0 && index < candidates.length) {
      return candidates[index].id;
    }
  }

  // 2. Try exact label match (case-insensitive)
  const lowerInput = trimmed.toLowerCase();
  const exactMatch = candidates.find(
    (c) => c.label.toLowerCase() === lowerInput
  );
  if (exactMatch) {
    return exactMatch.id;
  }

  // 3. Try partial label match (contains)
  const partialMatch = candidates.find(
    (c) => c.label.toLowerCase().includes(lowerInput)
  );
  if (partialMatch) {
    return partialMatch.id;
  }

  return null;
}

/**
 * Human-in-the-loop confirmation node.
 *
 * Reads pendingHumanAction.candidates + last user message, parses the selection,
 * and sets resolvedEntities (single source of truth) based on entityType.
 *
 * NOTE: This node reads pendingHumanAction (not pendingConfirmation).
 */
export async function humanConfirmationNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  console.log(`[humanConfirmationNode] resolvedEntities=${JSON.stringify(state.resolvedEntities)} waiting=${state.waitingForConfirmation}`);

  const lastMessage = state.messages[state.messages.length - 1];
  const userContent =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : "";

  const candidates = state.pendingHumanAction?.candidates ?? [];

  const result = parseSelection(userContent, candidates);

  // Handle skip / cancel
  if (result === "skip") {
    return {
      waitingForConfirmation: false,
      pendingHumanAction: null,
      resolvedEntities: null,
      messages: [
        ...state.messages,
        new AIMessage(
          "好的，已取消本次确认。请重新描述你的问题或换一个关键词。"
        ),
      ],
    };
  }

  // Handle valid selection — assign to the correct entity field based on entityType
  if (result) {
    const confirmed = candidates.find((c) => c.id === result)!;
    const entityType = state.pendingHumanAction?.entity ?? state.pendingHumanAction?.entityType ?? "user";

    // Extract the original query type from sourceResult (set by disambiguateIntentNode).
    // This tells us the real query type, not what the user typed ("1", "2"...).
    // e.g. for "刘工的周报有哪些" → disambiguateIntent returns entityType=user,
    // but the real queryType is "weekly_report" so we can redo the query.
    const sourceResult = state.pendingHumanAction?.sourceResult as { queryType?: string } | undefined;
    const originalQueryType = sourceResult?.queryType;
    console.log(`[humanConfirmationNode] resolved entityType=${entityType} confirmed.id=${confirmed.id} originalQueryType=${originalQueryType ?? "none"}`);

    let resolvedEntities: AgentState["resolvedEntities"] = null;

    if (entityType === "user") {
      resolvedEntities = {
        user: { id: confirmed.id, name: confirmed.label, resolvedBy: "confirmation" },
        originalQueryType: originalQueryType as "ticket" | "project" | "user" | "commit" | "weekly_report" | undefined,
        // Carry original query so searchStructuredNode can re-parse it on the next round
        // (instead of using the selection message as the new query).
        originalQuery: state.originalQuery || state.pendingHumanAction?.query,
      };
      // 保存最近讨论的用户，供后续对话中"他/她"等代词引用
      return {
        waitingForConfirmation: false,
        pendingHumanAction: null,
        resolvedEntities,
        // Consume queryType: clear it so the next routeAfterSearchStructured doesn't
        // re-trigger Branch 2 (ambiguous). The real type is now carried by
        // resolvedEntities.originalQueryType and the next detectIntent will refill
        // queryType from the new user message.
        queryType: null,
        originalQuery: state.originalQuery,
        lastMentionedUser: { id: confirmed.id, name: confirmed.label },
      };
    } else if (entityType === "weekly_report") {
      resolvedEntities = {
        weekly_report: { id: confirmed.id, name: confirmed.label, resolvedBy: "confirmation" },
        originalQueryType: originalQueryType as "ticket" | "project" | "user" | "commit" | "weekly_report" | undefined,
        originalQuery: state.originalQuery || state.pendingHumanAction?.query,
      };
      return {
        waitingForConfirmation: false,
        pendingHumanAction: null,
        resolvedEntities,
        queryType: null,
        originalQuery: state.originalQuery,
      };
    } else if (entityType === "ticket") {
      resolvedEntities = {
        ticket: { id: confirmed.id, name: confirmed.label, resolvedBy: "confirmation" },
        originalQueryType: originalQueryType as "ticket" | "project" | "user" | "commit" | "weekly_report" | undefined,
      };
      return {
        waitingForConfirmation: false,
        pendingHumanAction: null,
        resolvedEntities,
        queryType: null,
        originalQuery: state.originalQuery,
      };
    } else if (entityType === "project") {
      resolvedEntities = {
        project: { id: confirmed.id, name: confirmed.label, resolvedBy: "confirmation" },
        originalQueryType: originalQueryType as "ticket" | "project" | "user" | "commit" | "weekly_report" | undefined,
      };
      return {
        waitingForConfirmation: false,
        pendingHumanAction: null,
        resolvedEntities,
        queryType: null,
        originalQuery: state.originalQuery,
      };
    }

    // Fallback for any other entity types
    return {
      waitingForConfirmation: false,
      pendingHumanAction: null,
      resolvedEntities,
      queryType: null,
      originalQuery: state.originalQuery,
    };
  }
  // Handle invalid selection — user said "都不是" or typed something that doesn't match any candidate.
  // Cancel this round of disambiguation so the user can rephrase their question.
  if (result === null) {
    return {
      waitingForConfirmation: false,
      pendingHumanAction: null,
      resolvedEntities: null,
      queryType: null,
      messages: [
        ...state.messages,
        new AIMessage(
          "好的，没有找到匹配的选项。你可以换个说法重新提问，比如直接告诉我你是谁。\n\n比如：\"我是刘工\""
        ),
      ],
    };
  }

  const options = candidates
    .map((c, i) => `${i + 1}. ${c.label}`)
    .join("\n");
  return {
    waitingForConfirmation: true,
    pendingHumanAction: state.pendingHumanAction,
    messages: [
      ...state.messages,
      new AIMessage(
        `⚠️ 输入无效，请从以下选项中选择：\n${options}\n\n直接输入数字（如 1、2）或输入选项中的姓名。`
      ),
    ],
  };
}
