import { describe, expect, it } from "vitest";
import { fuseCandidatesWithRRF } from "./fusion-rrf";
import type { GraphCandidateChunk } from "./retrieval-graph";

describe("fusion-rrf", () => {
  const makeItem = (id: string, title: string) => ({
    documentId: id,
    sourceType: "TICKET",
    sourceId: `src_${id}`,
    chunkIndex: 0,
    title,
    content: `Content for ${title}`,
    metadata: { ticketNo: 10001, projectName: "DemoProject" },
    projectId: "proj_1",
    href: `/tickets/src_${id}`,
  });

  const makeGraphItem = (
    id: string,
    title: string,
    paths: string[] = [],
  ): GraphCandidateChunk => ({
    documentId: id,
    sourceType: "TICKET",
    sourceId: `src_${id}`,
    chunkIndex: 0,
    title,
    content: `Content for ${title}`,
    metadata: { ticketNo: 10001 },
    projectId: "proj_1",
    hopDistance: 1,
    hitFrequency: 1,
    paths,
    graphScore: 1.0,
  });

  it("calculates RRF correctly and merges multi-source results", () => {
    // doc1: 在 keyword 中排名 1，也在 vector 中排名 1
    // doc2: 仅在 keyword 中排名 2
    // doc3: 仅在 graph 中排名 1
    const keywordItems = [makeItem("doc1", "Doc 1"), makeItem("doc2", "Doc 2")];
    const vectorItems = [makeItem("doc1", "Doc 1")];
    const graphItems = [
      makeGraphItem("doc3", "Doc 3", ["Project -> HAS_TICKET -> Ticket 10001"]),
    ];

    const results = fuseCandidatesWithRRF(
      keywordItems,
      vectorItems,
      graphItems,
      {
        mode: "MIX",
        limit: 10,
      },
    );

    expect(results).toHaveLength(3);
    // doc1 在 keyword 和 vector 两路都是第一名，分数最高
    expect(results[0].id).toBe("doc1");
    expect(results[0].sources).toContain("keyword");
    expect(results[0].sources).toContain("vector");
    expect(results[0].rrfScore).toBeGreaterThan(results[1].rrfScore);

    // 检查 doc3 带有图谱路径
    const doc3Result = results.find((r) => r.id === "doc3");
    expect(doc3Result).toBeDefined();
    expect(doc3Result?.sources).toContain("graph");
    expect(doc3Result?.knowledgePaths).toContain(
      "Project -> HAS_TICKET -> Ticket 10001",
    );
  });

  it("respects NAIVE mode by excluding graph leg", () => {
    const keywordItems = [makeItem("doc1", "Doc 1")];
    const vectorItems = [makeItem("doc2", "Doc 2")];
    const graphItems = [makeGraphItem("doc3", "Doc 3")];

    const results = fuseCandidatesWithRRF(
      keywordItems,
      vectorItems,
      graphItems,
      {
        mode: "NAIVE",
        limit: 10,
      },
    );

    // NAIVE 模式下 graph weight = 0，仅由 graph 召回的 doc3 得分为 0，排在最后或不包含 graph 贡献
    const doc3 = results.find((r) => r.id === "doc3");
    expect(doc3?.rrfScore ?? 0).toBe(0);
  });
});
