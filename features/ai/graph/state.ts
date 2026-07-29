/**
 * Agent mode types — mirrors the existing ToolMode from features/ai/tools/index.ts
 */
export type AgentMode = "auto" | "search" | "chat" | "web";

/**
 * Structured-query fields populated by detectIntent and consumed by
 * searchStructured + decision nodes. Re-exported so other modules (e.g. tests)
 * can reference them without reaching into the Annotation internals.
 */
export type {
  QueryType,
} from "@/features/ai/core/resolvers/query-parser";
export type {
  ExtractedUser,
  ActivityWindow,
} from "@/features/ai/types/structured";