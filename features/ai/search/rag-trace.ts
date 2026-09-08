import type { QueryUnderstanding } from "./query-understanding";
import type { RetrievalReport, Evidence } from "./retrieval-router";
import type { RerankResult } from "./reranker";

export interface RagTrace {
  query: {
    raw: string;
    subject: string;
    scope: string;
    fineGrainedIntent: string;
    legacyIntent: string;
    requestedTypes: string[];
    explicitTypes: string[];
    entityBindings?: Array<{
      type: string;
      id: string;
      name: string;
      confidence: number;
    }>;
    ambiguity?: { score: number; isAmbiguous: boolean; reason?: string };
    subQueries?: string[];
  };
  router: {
    route: string;
    rationale: string;
    fallbackOccurred: boolean;
    fallbackReason?: string;
    lanes: string[];
  };
  retrieval: {
    attempts: Array<{
      round: number;
      retriever: string;
      status: string;
      count: number;
    }>;
    totalRetrieved: number;
    byChannel: Record<string, number>;
    /** Full candidate pool prior to reranking with initial RRF / retrieval rank */
    candidates: Array<{
      id: string;
      type: string;
      title: string;
      channel: string;
      rrfRank: number;
      paths?: string[];
    }>;
  };
  graph?: {
    pathsCount: number;
    paths: string[];
  };
  reranking: {
    totalBefore: number;
    totalAfter: number;
    topK: number;
    items: Array<{
      id: string;
      type: string;
      title: string;
      rrfRank: number;
      rerankScore: number;
      score: number;
      channel: string;
      reasons: string[];
    }>;
  };
  evaluation: {
    status: string;
    score: number;
    reason: string;
    suggestions: Array<{ label: string; query: string }>;
  };
  timing: {
    tookMs: number;
    timestamp: string;
  };
}

/**
 * Builds a standardized, serialization-safe RAG Trace inspection artifact.
 */
export function buildRagTrace(options: {
  rawQuery: string;
  plan: QueryUnderstanding;
  report: RetrievalReport;
  reranked?: RerankResult<Evidence>[];
  totalTookMs?: number;
}): RagTrace {
  const { rawQuery, plan, report, reranked, totalTookMs = 0 } = options;

  // Channel distribution and candidate pool with initial retrieval/RRF rank
  const byChannel: Record<string, number> = {};
  const candidates = report.evidence.map((item, index) => {
    byChannel[item.channel] = (byChannel[item.channel] ?? 0) + 1;
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      channel: item.channel,
      rrfRank: index + 1,
      paths: item.paths,
    };
  });

  const initialRankMap = new Map<string, number>(
    report.evidence.map((item, index) => [item.id, index + 1]),
  );

  // Graph paths
  const allPaths = report.evidence.flatMap((item) => item.paths ?? []);

  // Reranking items with initial rrfRank and final rerankScore
  const rerankItems = (reranked ?? []).map((r) => ({
    id: r.item.id,
    type: r.item.type,
    title: r.item.title,
    rrfRank: initialRankMap.get(r.item.id) ?? 1,
    rerankScore: r.relevanceScore,
    score: r.relevanceScore,
    channel: r.item.channel,
    reasons: r.reasons,
  }));

  // Router rationale string
  let rationale = `基于意图「${plan.fineGrainedIntent}」与范围「${plan.scope}」决定路由模式为 ${report.route}`;
  if (report.fallbackOccurred) {
    rationale += `；主路发生异常或查空，已安全降级至 Hybrid 检索（${report.fallbackReason ?? "fallback"}）`;
  }

  return {
    query: {
      raw: rawQuery,
      subject: plan.subject,
      scope: plan.scope,
      fineGrainedIntent: plan.fineGrainedIntent,
      legacyIntent: plan.intent,
      requestedTypes: plan.requestedTypes,
      explicitTypes: plan.explicitTypes,
      entityBindings: plan.bindings?.map((b) => ({
        type: b.entityType,
        id: b.id,
        name: b.name,
        confidence: b.confidence,
      })),
      ambiguity: plan.ambiguity
        ? {
            score: plan.ambiguity.score,
            isAmbiguous: plan.ambiguity.isAmbiguous,
            reason: plan.ambiguity.reason,
          }
        : undefined,
      subQueries: plan.subQueries,
    },
    router: {
      route: report.route,
      rationale,
      fallbackOccurred: Boolean(report.fallbackOccurred),
      fallbackReason: report.fallbackReason,
      lanes: [...new Set(report.attempts.map((a) => a.retriever))],
    },
    retrieval: {
      attempts: report.attempts,
      totalRetrieved: report.evidence.length,
      byChannel,
      candidates,
    },
    graph:
      allPaths.length > 0
        ? {
            pathsCount: allPaths.length,
            paths: allPaths.slice(0, 10),
          }
        : undefined,
    reranking: {
      totalBefore: report.evidence.length,
      totalAfter: rerankItems.length,
      topK: rerankItems.length,
      items: rerankItems,
    },
    evaluation: {
      status: report.evaluation.status,
      score: report.evaluation.score,
      reason: report.evaluation.reason,
      suggestions: report.evaluation.suggestions.map((s) => ({
        label: s.label,
        query: s.query,
      })),
    },
    timing: {
      tookMs: totalTookMs,
      timestamp: new Date().toISOString(),
    },
  };
}
