import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentMode } from "./state";
import { detectIntent } from "./nodes/detect-intent";
import { searchKnowledgeNode } from "./nodes/search-knowledge";
import { searchStructuredNode } from "./nodes/search-structured";
import { webSearchNode } from "./nodes/web-search";
import { generateResponseNode } from "./nodes/generate-response";
import { routeByMode } from "./edges/routing";

/**
 * Define state schema using LangGraph's Annotation API.
 * This is the idiomatic way for LangGraph JS 1.x.
 */
const AgentStateAnnotation = Annotation.Root({
  /** Conversation message history */
  messages: Annotation<BaseMessage[]>({
    value: (current, update) => {
      if (!Array.isArray(update)) return current ?? [];
      return [...(current ?? []), ...update];
    },
    default: () => [],
  }),
  /** Detected mode based on intent */
  mode: Annotation<AgentMode>({
    value: (current, update) => update ?? current,
    default: () => "auto",
  }),
  /** Search results from various tools */
  searchResults: Annotation<string[]>({
    value: (current, update) =>
      current ? [...current, ...update] : update,
    default: () => [],
  }),
  /** Final text response to stream back to the user */
  response: Annotation<string>({
    value: (_current, update) => update ?? "",
    default: () => "",
  }),
  /** Tool call results keyed by tool name */
  toolResults: Annotation<Record<string, unknown>>({
    value: (current = {}, update = {}) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  /** User name for personalization (passed in at invocation time) */
  userName: Annotation<string>({
    value: (_current, update) => update ?? "",
    default: () => "",
  }),
  /** User profile for personalization */
  profile: Annotation<Record<string, unknown> | null>({
    value: (_current, update) => update ?? null,
    default: () => null,
  }),
  /** User's city for weather / real-time data queries */
  clientCity: Annotation<string | null>({
    value: (_current, update) => update ?? null,
    default: () => null,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type PartialAgentState = typeof AgentStateAnnotation.Update;

/** Node names used in the routing graph */
export type NextNode =
  | "searchKnowledge"
  | "searchStructured"
  | "webSearch"
  | "generateResponse"
  | typeof END;

/**
 * Build the LangGraph StateGraph.
 *
 * Flow:
 *   START → detectIntent → addConditionalEdges ─┬─→ searchKnowledge → searchStructured ─┐
 *                                               ├─→ searchStructured (auto mode)        ┤
 *                                               ├─→ webSearch                           ┤
 *                                               └─→ generateResponse (chat mode)        │
 *                                                                                        ▼
 *                                                                              generateResponse → END
 */
function buildWorkflow() {
  const workflow = new StateGraph(AgentStateAnnotation)
    // Add all nodes
    .addNode("detectIntent", detectIntent)
    .addNode("searchKnowledge", searchKnowledgeNode)
    .addNode("searchStructured", searchStructuredNode)
    .addNode("webSearch", webSearchNode)
    .addNode("generateResponse", generateResponseNode)
    // Entry point
    .addEdge(START, "detectIntent")
    // Conditional edges from detectIntent — routes by mode
    .addConditionalEdges("detectIntent", routeByMode, {
      searchKnowledge: "searchKnowledge",
      searchStructured: "searchStructured",
      webSearch: "webSearch",
      generateResponse: "generateResponse",
    })
    // searchKnowledge → searchStructured → generateResponse
    .addEdge("searchKnowledge", "searchStructured")
    .addEdge("searchStructured", "generateResponse")
    // webSearch → generateResponse
    .addEdge("webSearch", "generateResponse")
    // generateResponse → END
    .addEdge("generateResponse", END)
    // Compile (no recursionLimit in JS API — uses defaults)
    .compile();

  return workflow;
}

/** Singleton compiled graph */
let _compiledGraph: ReturnType<typeof buildWorkflow> | null = null;

export function getCompiledGraph() {
  if (!_compiledGraph) {
    _compiledGraph = buildWorkflow();
  }
  return _compiledGraph;
}

/** Convenience export */
export const agentGraph = getCompiledGraph();
