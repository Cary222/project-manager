import type { AgentState } from "../agent";
import { searchStructured } from "@/features/ai/tools/search-structured";
import { setSearchStructuredViewer } from "@/features/ai/tools/search-structured";

/**
 * Inject runtime context into module-scoped closures.
 * Must be called before the tool executes.
 */
export function injectSearchStructuredContext(viewerUserId: string) {
  setSearchStructuredViewer(viewerUserId);
}

/**
 * Wraps the existing searchStructured tool as a graph node.
 * Executes structured DB queries (tickets, projects, users, commits, reports).
 */
export async function searchStructuredNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage) return {};

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

  try {
    const queryType = parseQueryType(content);
    // Extract ID from content (e.g., #10156 → 10156)
    const extractedId = extractId(content);

    console.log(`[AI-LangGraph] searchStructured type=${queryType} id=${extractedId} content="${content.slice(0, 50)}"`);

    const result = await searchStructured.execute(
      { type: queryType, id: extractedId, limit: 5 },
      { context: {}, messages: [], toolCallId: "lg-search-structured" }
    );

    const resultText =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

    console.log(`[AI-LangGraph] searchStructured result length=${resultText.length}, content=${resultText.slice(0, 200)}`);

    return {
      searchResults: [resultText],
      toolResults: { searchStructured: result },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AI-LangGraph] searchStructured error: ${msg}`);
    return {
      searchResults: [`[searchStructured error] ${msg}`],
      toolResults: { searchStructured: { error: msg } },
    };
  }
}

/**
 * Extract ID from user content.
 * Handles patterns like "#10156", "工单 10156", "ticket #10156"
 */
function extractId(content: string): string | undefined {
  // Match # followed by digits
  const ticketMatch = content.match(/#(\d+)/);
  if (ticketMatch) return ticketMatch[1];

  // Match 工单号/工单 followed by digits
  const gongdanMatch = content.match(/工单[号]?\s*[:：]?\s*(\d+)/i);
  if (gongdanMatch) return gongdanMatch[1];

  // Match "ticket #123" pattern
  const ticketWordMatch = content.match(/ticket\s*#?(\d+)/i);
  if (ticketWordMatch) return ticketWordMatch[1];

  return undefined;
}

/**
 * Simple heuristic to pick the initial query type.
 * The LLM in generateResponse can refine this.
 */
function parseQueryType(content: string): "ticket" | "project" | "user" | "commit" | "weekly_report" {
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  return "user";
}
