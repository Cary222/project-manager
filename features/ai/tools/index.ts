import { tool, type Tool } from "ai";
import { webSearch } from "./web-search";
import { searchKnowledge } from "./search-knowledge";

export { webSearch, searchKnowledge };

export type ToolMode = "auto" | "web" | "search" | "chat";

type WebToolSet = { webSearch: typeof webSearch; searchKnowledge: typeof searchKnowledge };
type SearchToolSet = { searchKnowledge: typeof searchKnowledge };

export function toolsetForMode(
  mode: ToolMode
): WebToolSet | SearchToolSet | undefined {
  if (mode === "auto" || mode === "web") return { webSearch, searchKnowledge };
  if (mode === "search") return { searchKnowledge };
  return undefined;
}
