/**
 * Unified type exports for the AI feature types.
 */

// Re-export all types from submodules
export type { AiMode, AiModeOption } from "./modes";
export { AI_MODE_OPTIONS } from "./modes";

export type { ThinkingNodeName, ThinkingStepStatus, ThinkingStep } from "./thinking";
export { buildStepPlan } from "./thinking";

export type {
  MatchType,
  ResolveResult,
  SourceReference,
  UserActivityAttribution,
  DisambiguationAttribution,
  Attribution,
  StructuredResult,
  ExtractedUser,
  ActivityWindow,
} from "./structured";
export { DISAMBIGUATION_THRESHOLDS } from "./structured";
