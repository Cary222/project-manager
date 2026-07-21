import type { AgentState } from "../agent";
import { searchKnowledge } from "@/features/ai/tools/search-knowledge";
import { setSearchKnowledgeViewer, setSearchKnowledgeConversationId } from "@/features/ai/tools/search-knowledge";

/**
 * Inject runtime context into module-scoped closures.
 * Must be called before the tool executes.
 */
export function injectSearchKnowledgeContext(
  viewerUserId: string,
  conversationId: string
) {
  setSearchKnowledgeViewer(viewerUserId);
  setSearchKnowledgeConversationId(conversationId);
}

/**
 * Wraps the existing searchKnowledge tool as a graph node.
 * Executes semantic search against the knowledge base.
 */
export async function searchKnowledgeNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage) return {};

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

  try {
    const result = await searchKnowledge.execute(
      { query: content, limit: 5 },
      { context: {}, messages: [], toolCallId: "lg-search-knowledge" }
    );

    const resultText =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

    return {
      searchResults: [resultText],
      toolResults: { searchKnowledge: result },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      searchResults: [`[searchKnowledge error] ${msg}`],
      toolResults: { searchKnowledge: { error: msg } },
    };
  }
}
