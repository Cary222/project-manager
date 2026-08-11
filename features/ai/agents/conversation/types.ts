/**
 * Human-in-Loop shared type definitions for the AI graph.
 */

/** Candidate item rendered in the disambiguation UI */
export interface DisambiguationCandidate {
  id: string;
  label: string;   // e.g. "1. cary（刘屹鹏）"
  summary: string; // e.g. "ROOT · 在职 1 个月"
}

/** Workflow match result from intent detection */
export interface WorkflowMatchCandidate {
  id: string;
  label: string;
  summary: string;
  type: string;
  description: string;
}

/** Decision returned by a Tool when the result requires human confirmation */
export interface ToolDecision {
  type: "human";
  reason: string;
  entityType: "user" | "ticket" | "project" | "weekly_report" | string;
  candidates: DisambiguationCandidate[];
}

/** Unified Tool return protocol — all graph tools should return this shape */
export interface ToolResult {
  data: unknown;
  decision?: ToolDecision;
}

/** Unified Human-in-Loop state — replaces pendingConfirmation */
export interface PendingHumanAction {
  type: "select" | "approve" | "confirm" | "input" | "upload";
  entity?: string;
  reason?: string;
  candidates?: DisambiguationCandidate[];
  query?: string;
  sourceResult?: unknown;
}
