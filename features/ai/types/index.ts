/**
 * Unified type exports for the AI feature types.
 */

// Re-export all types from submodules
export type { AiMode, AiModeOption, AiTaskCategory, ChatToolMode } from "./modes";
export { AI_MODE_OPTIONS, CHAT_SUB_MODE_OPTIONS } from "./modes";

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

export type {
  TaskStatus,
  TaskCategory,
  TaskRecord,
  TimelineCommand,
} from "./timeline";
export {
  NODE_CATEGORY_MAP,
  NODE_STEP_LABELS,
  NODE_DISPLAY_TITLES,
  mapThinkingStatus,
} from "./timeline";
