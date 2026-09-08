import type { AgentState } from "../agent";
import { webSearch } from "@/features/ai/tools/web-search";
import { resolveQueryScope } from "@/features/ai/search/query-understanding";

/**
 * Wraps the existing webSearch tool as a graph node.
 * Appends user's city to the query for location-aware results (weather, etc.).
 */
export async function webSearchNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage) return {};

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

  const report = state.toolResults?.retrieval as { allowWeb?: boolean; rewritten?: boolean } | undefined;
  if (resolveQueryScope(content) === "INTERNAL_ONLY" || state.retrievalPlan?.scope !== "WEB_ALLOWED" || report?.allowWeb !== true || !report.rewritten) {
    return { toolResults: { webSearch: { blocked: true, reason: "尚未获准公网补充检索" } } };
  }

  // Append city to query if available (weather, local info, etc.)
  const city = state.clientCity;
  const enrichedQuery = city
    ? `${content} ${city}`
    : content;

  try {
    const result = await webSearch.execute(
      { query: enrichedQuery, maxResults: 5 },
      { context: {}, messages: [], toolCallId: "lg-web-search" }
    );

    const resultText =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

    return {
      searchResults: [resultText],
      toolResults: { webSearch: result },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      searchResults: [`[webSearch error] ${msg}`],
      toolResults: { webSearch: { error: msg } },
    };
  }
}
