/**
 * 多路检索候选融合器 (Reciprocal Rank Fusion - RRF)
 *
 * 理论与工程参考：
 *   - GitNexus (gitnexus/src/core/search/hybrid-search.ts)
 *   - pg-raggraph (research/rrf-fusion-vs-prior-art.md)
 *
 * RRF 公式：
 *   RRF_Score(d) = Σ_m [ w_m / (k + rank_m(d)) ]
 *   其中 k = 60 (IR 业界经典平滑常数)
 */

import { RRF_K, RRF_WEIGHTS, type RetrievalMode } from "./types";
import type { GraphCandidateChunk } from "./retrieval-graph";
import type { SearchResultItem } from "../search-types";

export interface RankedFusedCandidate extends SearchResultItem {
  rrfScore: number;
  sources: Array<"keyword" | "vector" | "graph">;
  keywordRank?: number;
  vectorRank?: number;
  graphRank?: number;
  knowledgePaths?: string[];
  hopDistance?: number;
}

export interface FuseOptions {
  mode?: RetrievalMode;
  limit?: number;
}

interface RawCandidateItem {
  documentId: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  href: string;
  rawScore?: number;
  distance?: number;
  paths?: string[];
  hopDistance?: number;
}

/**
 * 将 Keyword、Vector、Graph 三路候选融合重排
 */
function toSearchResultType(sourceType: string): SearchResultItem["type"] {
  switch (sourceType.toUpperCase()) {
    case "TICKET":
      return "ticket";
    case "COMMIT":
      return "commit";
    case "PKM_NOTE":
      return "note";
    case "DOCUMENT":
      return "doc";
    default:
      return "doc";
  }
}

function toEntityUrl(
  type: SearchResultItem["type"],
  sourceId: string,
  projectId?: string | null,
): string {
  switch (type) {
    case "ticket":
      return `/tickets/${sourceId}`;
    case "commit":
      return `/tickets/${sourceId}`;
    case "note":
      return `/pkm/notes/${sourceId}`;
    case "doc":
      return projectId
        ? `/projects/${projectId}/documents/${sourceId}`
        : `/knowledge`;
    default:
      return `/knowledge`;
  }
}

export function fuseCandidatesWithRRF(
  keywordItems: RawCandidateItem[],
  vectorItems: RawCandidateItem[],
  graphItems: GraphCandidateChunk[],
  options: FuseOptions = {},
): RankedFusedCandidate[] {
  const { mode = "MIX", limit = 10 } = options;
  const weights = RRF_WEIGHTS[mode] ?? RRF_WEIGHTS.MIX;

  // 使用 Map<documentId, RankedFusedCandidate> 进行去重归拢
  const merged = new Map<string, RankedFusedCandidate>();

  function getOrCreate(item: {
    documentId: string;
    sourceType: string;
    sourceId: string;
    chunkIndex: number;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    projectId?: string | null;
    href?: string;
  }): RankedFusedCandidate {
    const existing = merged.get(item.documentId);
    if (existing) return existing;

    const resultType = toSearchResultType(item.sourceType);
    const itemUrl =
      item.href ?? toEntityUrl(resultType, item.sourceId, item.projectId);

    const candidate: RankedFusedCandidate = {
      id: item.documentId,
      type: resultType,
      title: item.title,
      snippet: item.content.slice(0, 300),
      project: item.projectId
        ? {
            id: item.projectId,
            name: (item.metadata?.projectName as string) || "所属项目",
          }
        : null,
      url: itemUrl,
      score: 0,
      keywordScore: 0,
      semanticScore: 0,
      metadata: (item.metadata ?? {}) as SearchResultItem["metadata"],
      rrfScore: 0,
      sources: [],
      knowledgePaths: [],
    };
    merged.set(item.documentId, candidate);
    return candidate;
  }

  // 1. Keyword 候选打分（若 weights.keyword > 0）
  if (weights.keyword > 0 && keywordItems) {
    for (let rank = 1; rank <= keywordItems.length; rank++) {
      const item = keywordItems[rank - 1];
      const entry = getOrCreate(item);
      const contribution = weights.keyword / (RRF_K + rank);
      entry.rrfScore += contribution;
      entry.keywordRank = rank;
      if (!entry.sources.includes("keyword")) entry.sources.push("keyword");
    }
  }

  // 2. Vector 候选打分（若 weights.vector > 0）
  if (weights.vector > 0 && vectorItems) {
    for (let rank = 1; rank <= vectorItems.length; rank++) {
      const item = vectorItems[rank - 1];
      const entry = getOrCreate(item);
      const contribution = weights.vector / (RRF_K + rank);
      entry.rrfScore += contribution;
      entry.vectorRank = rank;
      if (!entry.sources.includes("vector")) entry.sources.push("vector");
    }
  }

  // 3. Graph 候选打分（若 weights.graph > 0）
  if (weights.graph > 0 && graphItems) {
    for (let rank = 1; rank <= graphItems.length; rank++) {
      const item = graphItems[rank - 1];
      const entry = getOrCreate({
        documentId: item.documentId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        chunkIndex: item.chunkIndex,
        title: item.title,
        content: item.content,
        metadata: item.metadata,
        projectId: item.projectId,
      });
      const contribution = weights.graph / (RRF_K + rank);
      entry.rrfScore += contribution;
      entry.graphRank = rank;
      entry.hopDistance = item.hopDistance;
      if (item.paths && item.paths.length > 0) {
        entry.knowledgePaths = Array.from(
          new Set([...(entry.knowledgePaths ?? []), ...item.paths]),
        );
      }
      if (!entry.sources.includes("graph")) entry.sources.push("graph");
    }
  }

  // 4. 按 RRF 得分倒序排序
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  // 5. 同步主 score 字段便于向下游传递
  for (const c of sorted) {
    c.score = c.rrfScore;
  }

  return sorted;
}
