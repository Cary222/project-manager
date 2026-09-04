import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { TaskType, UserRoutingConfig } from "@/features/ai/llm/providers/types";
import type { AgentMode } from "./state";
import type { DisambiguationCandidate } from "./types";
import type { QueryType, ResolvedTimeWindow } from "@/features/ai/core/resolvers/query-parser";
import type { ExtractedUser, ActivityWindow } from "@/features/ai/types/structured";
import type { WorkflowDefinition } from "@/features/ai/runtime/types";

// ─── Workflow Match Types ────────────────────────────────────────────────────

export interface WorkflowMatch {
  /** Matched workflow type */
  type: string;
  /** Matched workflow metadata from registry */
  workflow: WorkflowDefinition;
  /** Confidence score 0-1 */
  confidence: number;
  /** Matched keyword that triggered this */
  matchedKeyword: string;
}

// ─── Human-in-Loop Types ────────────────────────────────────────────────────

export interface PendingHumanAction {
  type: "select" | "approve" | "confirm" | "input" | "upload";
  /** Short alias for entityType */
  entity?: string;
  /** Full entity type identifier */
  entityType: string;
  reason?: string;
  candidates?: DisambiguationCandidate[];
  query?: string;
  sourceResult?: unknown;
}

import { detectIntent } from "./nodes/detect-intent";
import { searchKnowledgeNode } from "./nodes/search-knowledge";
import { searchStructuredNode } from "./nodes/search-structured";
import { decision as disambiguateIntentNode, humanConfirmation as humanConfirmationNode } from "./nodes/decision";
import { webSearchNode } from "./nodes/web-search";
import { generateResponseNode } from "./nodes/generate-response";
import { modelSelectNode } from "./nodes/model-select";
import {
  routeAfterDetectIntent,
  routeAfterModelSelect,
  routeAfterHumanConfirmation,
  routeAfterSearchKnowledge,
  routeAfterSearchStructured,
  routeAfterDecision,
  routeAfterGenerateResponse,
} from "./edges/routing";

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
  /** User ID for permission checks and personalization */
  userId: Annotation<string>({
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
  /** Human-in-Loop: unified pending action state (replaces pendingConfirmation) */
  pendingHumanAction: Annotation<PendingHumanAction | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** Human-in-Loop: graph is waiting for user to make a selection */
  waitingForConfirmation: Annotation<boolean>({
    value: (current, update) => update === undefined ? current : update,
    default: () => false,
  }),
  /** Human-in-Loop: original query text saved before disambiguation (used after skip) */
  originalQuery: Annotation<string>({
    value: (_current, update) => update ?? "",
    default: () => "",
  }),
  /** Human-in-Loop: resolved entities (single source of truth) */
  resolvedEntities: Annotation<{
    user?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
    project?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
    ticket?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
    weekly_report?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
    originalQueryType?: "ticket" | "project" | "user" | "commit" | "weekly_report";
    /** Original user query (e.g. "刘工的周报有哪些") — set after disambiguation
     *  so searchStructuredNode can re-parse it on the follow-up round instead of
     *  using the selection message ("1" or "cary") as the new query. */
    originalQuery?: string;
  } | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** 最近讨论的用户（用于"他/她"等代词指代）。HIL 确认后设置。 */
  lastMentionedUser: Annotation<{ id: string; name: string } | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** 最近讨论的工单（用于"它/这个工单"等代词指代） */
  lastMentionedTicket: Annotation<{ id: string; ticketNo: number; title?: string } | null>({
    value: (current, update) => (update === undefined ? current : update),
    default: () => null,
  }),
  /** Structured query type (ticket/project/user/commit/weekly_report/note/ambiguous). */
  queryType: Annotation<QueryType | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** Extracted user identifier from the user message (raw + normalized). */
  extractedUser: Annotation<ExtractedUser | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** Activity time window (today/yesterday/this_week/this_month/recent). */
  activityWindow: Annotation<ActivityWindow | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** Structured temporal window with exact timestamps */
  resolvedTimeWindow: Annotation<ResolvedTimeWindow | null>({
    value: (current, update) => (update === undefined ? current : update),
    default: () => null,
  }),
  /** Model selection context (provider + model chosen for this turn). */
  modelContext: Annotation<{
    taskType: TaskType;
    providerId: string;
    modelName: string;
    userConfig?: UserRoutingConfig;
  } | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
  /** Workflow match result from intent detection — populated when user query matches a workflow pattern */
  workflowMatch: Annotation<WorkflowMatch | null>({
    value: (current, update) => update === undefined ? current : update,
    default: () => null,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type PartialAgentState = typeof AgentStateAnnotation.Update;

/** Node names used in the routing graph */
export type NextNode =
  | "detectIntent"
  | "modelSelect"
  | "searchKnowledge"
  | "searchStructured"
  | "decision"
  | "webSearch"
  | "generateResponse"
  | "humanConfirmation"
  | typeof END;

/**
 * Build the LangGraph StateGraph.
 *
 * Flow:
 *   START → detectIntent → addConditionalEdges ─┬─→ searchKnowledge → searchStructured → decision ─┬─→ humanConfirmation → decision → searchStructured
 *                                                 ├─→ searchStructured (auto mode)                                  │
 *                                                 ├─→ webSearch                                                                  │
 *                                                 └─→ generateResponse (chat mode)                                                     │
 *                                                                                                                                    ▼
 *                                                                                                                          generateResponse → END
 */
function buildWorkflow() {
  const workflow = new StateGraph(AgentStateAnnotation)
    // Add all nodes
    .addNode("detectIntent", detectIntent)
    .addNode("modelSelect", modelSelectNode)
    .addNode("searchKnowledge", searchKnowledgeNode)
    .addNode("searchStructured", searchStructuredNode)
    .addNode("decision", disambiguateIntentNode)
    .addNode("webSearch", webSearchNode)
    .addNode("generateResponse", generateResponseNode)
    .addNode("humanConfirmation", humanConfirmationNode)
    // Entry point
    .addEdge(START, "detectIntent")
    // detectIntent → modelSelect (always runs model selection first)
    .addEdge("detectIntent", "modelSelect")
    // modelSelect → conditional routing based on mode
    .addConditionalEdges("modelSelect", routeAfterModelSelect, {
      searchKnowledge: "searchKnowledge",
      searchStructured: "searchStructured",
      webSearch: "webSearch",
      generateResponse: "generateResponse",
      humanConfirmation: "humanConfirmation",
    })
    // searchKnowledge → searchStructured → (conditional: decision or generateResponse)
    .addEdge("searchKnowledge", "searchStructured")
    .addConditionalEdges("searchStructured", routeAfterSearchStructured, {
      decision: "decision",
      humanConfirmation: "humanConfirmation",
      generateResponse: "generateResponse",
    })
    // decision conditional edge
    .addConditionalEdges("decision", routeAfterDecision, {
      humanConfirmation: "humanConfirmation",
      searchStructured: "searchStructured",
      generateResponse: "generateResponse",
      [END]: END,
    })
    // Human confirmation: self-loop on invalid, go to decision on valid, END on nothing pending
    .addConditionalEdges("humanConfirmation", routeAfterHumanConfirmation, {
      humanConfirmation: "humanConfirmation",
      decision: "decision",
      [END]: END,
    })
    // webSearch → generateResponse
    .addEdge("webSearch", "generateResponse")
    // generateResponse → conditional (pending_human_action round 2 → humanConfirmation, else END)
    .addConditionalEdges("generateResponse", routeAfterGenerateResponse, {
      humanConfirmation: "humanConfirmation",
      [END]: END,
    })
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
