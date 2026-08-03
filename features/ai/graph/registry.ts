/**
 * NodeRegistry — single source of truth for graph node → UI metadata mapping.
 *
 * Why this file exists:
 *   TimelineAdapter + TimelineStore + UI all need to know how to *present* a node
 *   (short label, full title, category). v1 inlined three Record<string, …> maps
 *   inside `types/timeline.ts`. That made TimelineUI coupled to the type module
 *   and gave Phase 2/3 (Workflow / MCP) no clean extension point.
 *
 * This module decouples the registry from the type definitions and freezes the
 *   node name union so the TypeScript compiler refuses unknown node keys.
 *
 * Architecture:
 *   graph.stream() → Route → TimelineAdapter → TimelineStore → TreeBuilder → React
 *                                                              ↑
 *                                          reads from features/ai/graph/registry.ts
 *
 * Extending for Phase 2/3:
 *   - Add the new node name to `NodeName`
 *   - Add a NodeMeta entry to `nodeRegistry`
 *   - No changes required in TimelineAdapter / TimelineStore / UI
 */

import type { TaskCategory } from "@/features/ai/types/timeline";

// ─── Node Name Union ─────────────────────────────────────────────────────────

/**
 * All known graph node names. Adding a node here is a compile-time contract:
 * `nodeRegistry` keys must match this union exhaustively.
 */
export type NodeName =
  | "detectIntent"
  | "searchKnowledge"
  | "searchStructured"
  | "webSearch"
  | "modelSelect"
  | "decision"
  | "generateResponse"
  | "humanConfirmation"
  // Phase 2/3 placeholders — uncomment when those nodes land:
  // | "mcpRead"
  // | "mcpWrite"
  // | "mcpBash"
  // | "collectData"
  // | "waitApproval";

// ─── Node Metadata Shape ─────────────────────────────────────────────────────

/**
 * Per-node metadata consumed by TimelineAdapter / UI.
 * Keep this interface flat — no nested config objects. UI code reads it directly.
 */
export interface NodeMeta {
  /** Short user-facing label shown in the compact log stream (1–2 Chinese chars). */
  stepLabel: string;
  /** Full user-facing title shown when expanded ("AI is doing X"). */
  displayTitle: string;
  /** Category drives icon / grouping in the timeline UI. */
  category: TaskCategory;
}

// ─── Registry Table ──────────────────────────────────────────────────────────

/**
 * Frozen registry — exhaustive over `NodeName`.
 * `satisfies Record<NodeName, NodeMeta>` lets TS verify the keys without
 * widening the value type (each entry stays typed as NodeMeta).
 */
export const nodeRegistry = {
  detectIntent: {
    stepLabel: "意图识别",
    displayTitle: "正在理解你的问题",
    category: "reason",
  },
  searchKnowledge: {
    stepLabel: "知识检索",
    displayTitle: "正在检索知识库",
    category: "tool",
  },
  searchStructured: {
    stepLabel: "数据库查询",
    displayTitle: "正在查询业务数据",
    category: "tool",
  },
  webSearch: {
    stepLabel: "联网搜索",
    displayTitle: "正在联网搜索",
    category: "tool",
  },
  modelSelect: {
    stepLabel: "选择模型",
    displayTitle: "正在选择模型",
    category: "system",
  },
  decision: {
    stepLabel: "分析问题",
    displayTitle: "正在分析问题",
    category: "reason",
  },
  generateResponse: {
    stepLabel: "生成回答",
    displayTitle: "正在整理答案",
    category: "reason",
  },
  humanConfirmation: {
    stepLabel: "等待确认",
    displayTitle: "需要你的确认",
    category: "human",
  },
} as const satisfies Record<NodeName, NodeMeta>;

// ─── Backwards-Compatible Maps (re-exported via types/timeline.ts) ───────────
//
// TimelineAdapter + tests import these three Record shapes. To avoid a breaking
// change during the registry migration, the maps are derived from nodeRegistry.
// `as Record<string, T>` widens the key type so legacy call sites still work
// without sacrificing the strict union on the registry itself.

export const NODE_STEP_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(nodeRegistry).map(([k, v]) => [k, v.stepLabel]),
);

export const NODE_DISPLAY_TITLES: Record<string, string> = Object.fromEntries(
  Object.entries(nodeRegistry).map(([k, v]) => [k, v.displayTitle]),
);

export const NODE_CATEGORY_MAP: Record<string, TaskCategory> = Object.fromEntries(
  Object.entries(nodeRegistry).map(([k, v]) => [k, v.category]),
);

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

/**
 * Read-only meta lookup with safe fallback for unknown nodes.
 * Use this in TimelineAdapter so a single misconfigured node name never crashes
 * the stream — it just renders as "执行 <nodeName>" with category=system.
 */
export function getNodeMeta(nodeName: string): NodeMeta {
  const meta = (nodeRegistry as Record<string, NodeMeta | undefined>)[nodeName];
  return meta ?? { stepLabel: nodeName, displayTitle: `执行 ${nodeName}`, category: "system" };
}
