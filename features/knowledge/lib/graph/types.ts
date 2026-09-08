/**
 * Knowledge Graph 核心类型定义 (GraphRAG V1)
 *
 * 三层图谱模型：
 *   1. BUSINESS  — 确定性业务图（Prisma 数据直接同步，confidence=1.0）
 *   2. EXPLICIT  — 显式文档链接（[[WikiLink]]、Markdown 超链接）
 *   3. EXTRACTED — LLM 语义抽取（附带 confidence 与 extractorVersion）
 */

import type {
  KnowledgeNodeType,
  KnowledgeEdgeSourceType,
} from "@prisma/client";

// ─── 节点归一化工具 ────────────────────────────────────────────────

/** 将实体名称归一化为小写去重标识 */
export function normalizeEntityName(
  type: KnowledgeNodeType,
  rawName: string,
): string {
  const lower = rawName.trim().toLowerCase();
  switch (type) {
    case "TICKET":
      // "#10208" → "ticket_10208", "10208" → "ticket_10208"
      return `ticket_${lower.replace(/^#/, "")}`;
    case "USER":
      return `user_${lower.replace(/\s+/g, "_")}`;
    case "PROJECT":
      return `project_${lower.replace(/\s+/g, "_")}`;
    case "COMMIT":
      return `commit_${lower.substring(0, 12)}`;
    case "MODULE":
      return `module_${lower.replace(/\s+/g, "_")}`;
    case "MEETING":
      return `meeting_${lower.replace(/\s+/g, "_")}`;
    default:
      return lower.replace(/\s+/g, "_");
  }
}

// ─── 业务图关系类型常量 ────────────────────────────────────────────

/** 确定性业务关系动词 */
export const BusinessRelTypes = {
  HAS_TICKET: "HAS_TICKET",
  ASSIGNED_TO: "ASSIGNED_TO",
  CREATED_BY: "CREATED_BY",
  BELONGS_TO_MODULE: "BELONGS_TO_MODULE",
  MENTIONS_COMMIT: "MENTIONS_COMMIT",
  AUTHORED_BY: "AUTHORED_BY",
  BELONGS_TO_PROJECT: "BELONGS_TO_PROJECT",
  HAS_MODULE: "HAS_MODULE",
  HAS_MEETING: "HAS_MEETING",
} as const;

// ─── RRF 融合类型 ──────────────────────────────────────────────────

export type RetrievalMode = "NAIVE" | "LOCAL" | "MIX";

export interface GraphCandidate {
  sourceChunkId: string;
  hitFrequency: number;
  paths: string[][];
}

export interface RRFCandidate {
  id: string; // SearchDocument.id
  keywordRank: number | null;
  vectorRank: number | null;
  graphRank: number | null;
  rrfScore: number;
}

export const RRF_K = 60;

export const RRF_WEIGHTS: Record<
  RetrievalMode,
  { keyword: number; vector: number; graph: number }
> = {
  NAIVE: { keyword: 1.0, vector: 1.2, graph: 0.0 },
  LOCAL: { keyword: 0.8, vector: 1.0, graph: 1.5 },
  MIX: { keyword: 1.0, vector: 1.2, graph: 1.0 },
};

// ─── Re-exports ────────────────────────────────────────────────────

export type { KnowledgeNodeType, KnowledgeEdgeSourceType };
