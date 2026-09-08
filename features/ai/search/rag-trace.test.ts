import { describe, it, expect } from "vitest";
import { buildRagTrace } from "./rag-trace";
import { understandQuery } from "./query-understanding";
import type { RetrievalReport, Evidence } from "./retrieval-router";
import type { RerankResult } from "./reranker";

describe("P5 RAG Trace - Observability & Structure", () => {
  it("builds a complete, structured RAG trace artifact", () => {
    const rawQuery = "光污染设计涉及哪些站内工单和提交记录";
    const plan = understandQuery(rawQuery);
    plan.bindings = [
      {
        entityType: "project",
        id: "proj_1",
        name: "光污染计",
        matchType: "exact",
        confidence: 1.0,
      },
      {
        entityType: "note",
        id: "note_1",
        name: "光污染设计需求文档",
        matchType: "fuzzy",
        confidence: 0.8,
      },
    ];
    plan.ambiguity = {
      score: 0.75,
      isAmbiguous: true,
      reason: "同时匹配到项目与笔记",
      candidateEntities: plan.bindings,
    };

    const mockEvidence: Evidence[] = [
      {
        id: "e1",
        type: "project",
        title: "光污染计",
        content: "整机研发项目",
        url: "/projects/proj_1",
        channel: "structured",
      },
      {
        id: "e2",
        type: "ticket",
        title: "#10018 光污染传感器校准",
        content: "传感器采集校准",
        url: "/tickets/ticket_1",
        channel: "graph",
        paths: ["#10018 -[BELONGS_TO]-> 光污染计"],
      },
      {
        id: "e3",
        type: "note",
        title: "光污染设计需求文档",
        content: "硬件与协议说明",
        url: "/pkm/notes/note_1",
        channel: "hybrid",
      },
    ];

    const mockReport: RetrievalReport = {
      plan,
      route: "MIX",
      evidence: mockEvidence,
      attempts: [
        { round: 0, retriever: "structured", status: "ok", count: 1 },
        { round: 0, retriever: "hybrid", status: "ok", count: 1 },
        { round: 0, retriever: "graph", status: "ok", count: 1 },
      ],
      enough: true,
      missingTypes: [],
      rewritten: false,
      allowWeb: false,
      fallbackOccurred: false,
      evaluation: {
        status: "SUFFICIENT",
        score: 0.9,
        reason: "检索证据充沛，覆盖所需实体范围。",
        suggestions: [
          {
            id: "s1",
            label: "查看项目「光污染计」",
            query: "项目 光污染计 详情",
          },
        ],
        coverage: {
          requestedTypes: ["project", "note", "ticket", "commit"],
          coveredTypes: ["project", "ticket", "note"],
          missingTypes: ["commit"],
        },
      },
    };

    const mockReranked: RerankResult<Evidence>[] = [
      {
        item: mockEvidence[0],
        relevanceScore: 0.85,
        reasons: ["标题包含完整查询主题", "结构化业务事实优先"],
      },
      {
        item: mockEvidence[1],
        relevanceScore: 0.82,
        reasons: ["标题包含完整查询主题", "图谱关系路径支撑 (1条路径)"],
      },
      {
        item: mockEvidence[2],
        relevanceScore: 0.78,
        reasons: ["标题包含完整查询主题"],
      },
    ];

    const trace = buildRagTrace({
      rawQuery,
      plan,
      report: mockReport,
      reranked: mockReranked,
      totalTookMs: 145,
    });

    // 1. Query understanding verification
    expect(trace.query.raw).toBe(rawQuery);
    expect(trace.query.subject).toBe(plan.subject);
    expect(trace.query.scope).toBe("INTERNAL_ONLY");
    expect(trace.query.fineGrainedIntent).toBe("RELATION");
    expect(trace.query.entityBindings?.length).toBe(2);
    expect(trace.query.ambiguity?.isAmbiguous).toBe(true);

    // 2. Router verification
    expect(trace.router.route).toBe("MIX");
    expect(trace.router.rationale).toContain("RELATION");
    expect(trace.router.fallbackOccurred).toBe(false);
    expect(trace.router.lanes).toContain("structured");
    expect(trace.router.lanes).toContain("hybrid");
    expect(trace.router.lanes).toContain("graph");

    // 3. Retrieval channels verification
    expect(trace.retrieval.totalRetrieved).toBe(3);
    expect(trace.retrieval.byChannel.structured).toBe(1);
    expect(trace.retrieval.byChannel.hybrid).toBe(1);
    expect(trace.retrieval.byChannel.graph).toBe(1);
    expect(trace.retrieval.candidates.length).toBe(3);
    expect(trace.retrieval.candidates[0].rrfRank).toBe(1);
    expect(trace.retrieval.candidates[0].title).toBe("光污染计");

    // 4. Graph paths verification
    expect(trace.graph?.pathsCount).toBe(1);
    expect(trace.graph?.paths[0]).toContain("-[BELONGS_TO]->");

    // 5. Reranking verification
    expect(trace.reranking.items.length).toBe(3);
    expect(trace.reranking.items[0].score).toBe(0.85);
    expect(trace.reranking.items[0].rrfRank).toBe(1);
    expect(trace.reranking.items[0].rerankScore).toBe(0.85);
    expect(trace.reranking.items[0].reasons).toContain("结构化业务事实优先");
    // 6. Evaluation & Timing
    expect(trace.evaluation.status).toBe("SUFFICIENT");
    expect(trace.timing.tookMs).toBe(145);
    expect(trace.timing.timestamp).toBeTruthy();

    // 7. Safe JSON serialization
    const serialized = JSON.stringify(trace);
    expect(serialized).toBeTruthy();
    const parsed = JSON.parse(serialized);
    expect(parsed.router.route).toBe("MIX");
  });

  it("accurately records safe degradation in RAG trace when fallback occurs", () => {
    const rawQuery = "#10010";
    const plan = understandQuery(rawQuery);

    const mockReport: RetrievalReport = {
      plan,
      route: "STRUCTURED",
      evidence: [
        {
          id: "h1",
          type: "ticket",
          title: "#10010 备份文档",
          content: "降级获得的内容",
          url: "/tickets/t1",
          channel: "hybrid",
        },
      ],
      attempts: [
        { round: 0, retriever: "structured", status: "failed", count: 0 },
        { round: 0, retriever: "hybrid", status: "ok", count: 1 },
      ],
      enough: true,
      missingTypes: [],
      rewritten: false,
      allowWeb: false,
      fallbackOccurred: true,
      fallbackReason:
        "Primary route STRUCTURED failed; safely downgraded to Hybrid",
      evaluation: {
        status: "SUFFICIENT",
        score: 0.8,
        reason: "已通过降级检索获得证据",
        suggestions: [],
        coverage: {
          requestedTypes: ["ticket"],
          coveredTypes: ["ticket"],
          missingTypes: [],
        },
      },
    };

    const trace = buildRagTrace({
      rawQuery,
      plan,
      report: mockReport,
      totalTookMs: 88,
    });

    expect(trace.router.route).toBe("STRUCTURED");
    expect(trace.router.fallbackOccurred).toBe(true);
    expect(trace.router.fallbackReason).toContain(
      "safely downgraded to Hybrid",
    );
    expect(trace.router.rationale).toContain("已安全降级至 Hybrid 检索");
  });

  it("accurately records rank inversion and candidate pruning between initial pool and rerank results", () => {
    const rawQuery = "光污染核心设计";
    const plan = understandQuery(rawQuery);

    const preRerankEvidence: Evidence[] = [
      { id: "c1", type: "commit", title: "无关提交 FlashStorage", content: "调试信息", url: "/tickets/1", channel: "hybrid" },
      { id: "c2", type: "note", title: "普通讨论记录", content: "会议备忘", url: "/notes/2", channel: "hybrid" },
      { id: "c3", type: "note", title: "光污染核心设计说明", content: "核心方案详述", url: "/notes/3", channel: "structured", paths: ["p1 -> c3"] },
      { id: "c4", type: "ticket", title: "低质噪点任务", content: "无匹配文本", url: "/tickets/4", channel: "graph" },
    ];

    const mockReport: RetrievalReport = {
      plan,
      route: "MIX",
      evidence: preRerankEvidence,
      attempts: [{ round: 0, retriever: "hybrid", status: "ok", count: 4 }],
      enough: true,
      missingTypes: [],
      rewritten: false,
      allowWeb: false,
      evaluation: { status: "SUFFICIENT", score: 0.9, reason: "充分", suggestions: [], coverage: { requestedTypes: [], coveredTypes: [], missingTypes: [] } },
    };

    // Reranker inverts rank: c3 (initial rank #3) is promoted to rank #1; c1 and c4 are pruned
    const mockReranked: RerankResult<Evidence>[] = [
      { item: preRerankEvidence[2], relevanceScore: 0.95, reasons: ["标题完全匹配", "结构化事实"] },
      { item: preRerankEvidence[1], relevanceScore: 0.65, reasons: ["部分重合"] },
    ];

    const trace = buildRagTrace({
      rawQuery,
      plan,
      report: mockReport,
      reranked: mockReranked,
      totalTookMs: 42,
    });

    // 1. Initial pre-rerank candidate pool is preserved with true initial RRF ranks
    expect(trace.retrieval.totalRetrieved).toBe(4);
    expect(trace.retrieval.candidates.length).toBe(4);
    expect(trace.retrieval.candidates[2].id).toBe("c3");
    expect(trace.retrieval.candidates[2].rrfRank).toBe(3);

    // 2. Candidate pruning verified
    expect(trace.reranking.totalBefore).toBe(4);
    expect(trace.reranking.totalAfter).toBe(2);
    expect(trace.reranking.items.length).toBe(2);

    // 3. Rank inversion verified (initial rank #3 promoted to rerank position #1)
    expect(trace.reranking.items[0].id).toBe("c3");
    expect(trace.reranking.items[0].rrfRank).toBe(3);
    expect(trace.reranking.items[0].rerankScore).toBe(0.95);
    expect(trace.reranking.items[1].id).toBe("c2");
    expect(trace.reranking.items[1].rrfRank).toBe(2);
  });
});
