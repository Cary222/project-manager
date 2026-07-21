import type { AgentState } from "../agent";
import { webSearch } from "@/features/ai/tools/web-search";

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
