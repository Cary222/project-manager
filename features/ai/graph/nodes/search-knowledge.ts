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
 *
 * After human confirmation, `state.originalQuery` holds the real user question
 * (e.g. "刘工最近在做什么"). Use it instead of the injected internal message
 * that would otherwise be the last entry in state.messages.
 */
export async function searchKnowledgeNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  // Use originalQuery when available (after human confirmation / skip),
  // otherwise fall back to the last message content.
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage) return {};

  const rawContent =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

  // After confirmation the last message is the injected internal AI message.
  // `originalQuery` preserves the genuine user question.
  const content = state.originalQuery || rawContent;

  try {
    console.log(`[searchKnowledgeNode] executing with query="${content.slice(0, 60)}"`);
    const result = await searchKnowledge.execute(
      { query: content, limit: 5 },
      { context: {}, messages: [], toolCallId: "lg-search-knowledge" }
    );

    console.log(`[searchKnowledgeNode] result typeof=${typeof result} constructor=${result?.constructor?.name} isArray=${Array.isArray(result)} keys=${typeof result === 'object' && result !== null ? Object.keys(result as object).join(',') : 'N/A'}`);

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
