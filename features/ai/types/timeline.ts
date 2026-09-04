/**
 * Timeline types for AI thinking process visualization.
 * Provides a flat TaskRecord model + TimelineCommand operations
 * that can be consumed by the frontend to render a step-by-step tree.
 *
 * Architecture:
 *   graph.stream() → Route → TimelineAdapter → TimelineStore → TreeBuilder → React
 */

import type { ThinkingStepStatus } from "./thinking";

// ─── Task Status ─────────────────────────────────────────────────────────────

/**
 * Task execution status in the timeline.
 * Maps to LangGraph node lifecycle:
 *   pending → running → success | warning | error
 */
export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error";

// ─── Task Category ────────────────────────────────────────────────────────────

/**
 * Category classifies the nature of a task node.
 * Used for UI icons and grouping.
 */
export type TaskCategory =
  | "reason"   // Reasoning / analysis nodes (detectIntent, decision)
  | "tool"    // Tool execution nodes (searchKnowledge, searchStructured, webSearch)
  | "workflow" // Multi-step workflow nodes
  | "system"  // System nodes (modelSelect)
  | "human";  // Human-in-the-loop nodes (humanConfirmation)

// ─── Task Record ─────────────────────────────────────────────────────────────

/**
 * Flat task record — atomic unit of the timeline.
 * Stores one node's execution result in a flat Map.
 *
 * Note: parentId is always null in v1 since we don't have sub-graph spawning.
 * Future versions may set parentId when parallel nodes are spawned via Send.
 */
export interface TaskRecord {
  /** Unique execution ID (format: "nodeName-timestamp") */
  id: string;
  /** Parent task ID (for sub-task trees). null for root tasks. */
  parentId: string | null;
  /** LangGraph node name (e.g. "detectIntent") */
  nodeName?: string;
  /** Short user-facing label shown in the log stream (e.g. "理解") */
  stepLabel: string;
  /** Full user-facing title (e.g. "正在理解你的问题") */
  title: string;
  /** Execution status */
  status: TaskStatus;
  /** Optional detail extracted from node output (e.g. "找到 12 条周报") */
  detail?: string;
  /** Unix timestamp (ms) when the task started */
  startTime: number;
  /** Unix timestamp (ms) when the task ended (null if still running) */
  endTime?: number;
  /** Category for UI icon/theming */
  category: TaskCategory;
  /** Rich thinking/log content for expansion — extracted from node output logs.
   *  Array of { role, content } message objects from the reasoning model.
   *  Empty array means no logs yet; undefined means the node has no log output. */
  logs?: Array<{ role: string; content: string }>;
  /** Optional metadata (tool results, error message, etc.) */
  metadata?: Record<string, unknown>;
}

// ─── Timeline Command ─────────────────────────────────────────────────────────

/**
 * TimelineStore operations — CRDT-style command pattern.
 * All state mutations go through commands so subscribers can observe changes.
 */
export type TimelineCommand =
  | { op: "create"; task: TaskRecord }
  | { op: "update"; id: string; updates: Partial<TaskRecord> }
  | { op: "delete"; id: string }
  | { op: "snapshot"; tasks: TaskRecord[] };

// ─── Node Display Config ─────────────────────────────────────────────────────

/**
 * Icon variants for different task categories and statuses.
 * Used to render the correct icon in the timeline.
 */
export type NodeIconVariant =
  | "brain"     // 🧠 Reasoning/analysis
  | "search"    // 🔍 Knowledge/database search
  | "globe"     // 🌐 Web search
  | "tool"      // 🔧 General tool
  | "sparkle"   // ✨ Generation
  | "hand"      // 🤝 Human confirmation
  | "cpu"       // ⚙️ Model selection
  | "warning"   // ⚠️ Warning/skipped
  | "error"     // ✗ Error
  | "pending";  // ○ Pending

export interface NodeDisplayConfig {
  /** Short step label (1-2 chars) shown as badge */
  stepLabel: string;
  /** Full user-facing title (shown as main text) */
  title: string;
  /** Category for icon/color theming */
  category: TaskCategory;
  /** Icon variant for SVG rendering */
  icon: NodeIconVariant;
}

export const NODE_DISPLAY_CONFIG: Record<string, NodeDisplayConfig> = {
  detectIntent: {
    stepLabel: "理解",
    title: "正在理解你的问题",
    category: "reason",
    icon: "brain",
  },
  searchKnowledge: {
    stepLabel: "检索",
    title: "正在检索知识库",
    category: "tool",
    icon: "search",
  },
  searchStructured: {
    stepLabel: "查询",
    title: "正在查询业务数据",
    category: "tool",
    icon: "search",
  },
  webSearch: {
    stepLabel: "搜索",
    title: "正在联网搜索",
    category: "tool",
    icon: "globe",
  },
  modelSelect: {
    stepLabel: "模型",
    title: "正在选择合适的模型",
    category: "system",
    icon: "cpu",
  },
  decision: {
    stepLabel: "分析",
    title: "正在分析问题",
    category: "reason",
    icon: "brain",
  },
  generateResponse: {
    stepLabel: "生成",
    title: "正在整理答案",
    category: "reason",
    icon: "sparkle",
  },
  humanConfirmation: {
    stepLabel: "确认",
    title: "需要你的确认",
    category: "human",
    icon: "hand",
  },
};

// Legacy exports for backward compatibility
export const NODE_STEP_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(NODE_DISPLAY_CONFIG).map(([key, cfg]) => [key, cfg.stepLabel])
);
export const NODE_DISPLAY_TITLES: Record<string, string> = Object.fromEntries(
  Object.entries(NODE_DISPLAY_CONFIG).map(([key, cfg]) => [key, cfg.title])
);
export const NODE_CATEGORY_MAP: Record<string, TaskCategory> = Object.fromEntries(
  Object.entries(NODE_DISPLAY_CONFIG).map(([key, cfg]) => [key, cfg.category])
);

// ─── Status Helpers ───────────────────────────────────────────────────────────

/**
 * Maps ThinkingStepStatus (from thinking.ts) to TaskStatus.
 * This bridges the existing ThinkingStep model with the new TaskRecord model.
 */
export function mapThinkingStatus(status: ThinkingStepStatus): TaskStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "done":
      return "success";
    case "skipped":
      return "warning";
    case "error":
      return "error";
    default:
      return "pending";
  }
}
