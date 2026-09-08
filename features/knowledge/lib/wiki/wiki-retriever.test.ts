import { describe, it, expect, vi } from "vitest";
import { searchWikiCandidates, wikiPageToEvidence } from "./wiki-retriever";
import { getWikiPageBySlug, listAllWikiPages } from "./wiki-store";
import {
  synthesizeProjectWiki,
  syncWikiPageToSearchDocument,
  type WikiDatabaseClient,
} from "./wiki-synthesizer";
import { understandQuery } from "@/features/ai/search/query-understanding";
import {
  executeRetrievalPlan,
  decideRetrievalRoute,
} from "@/features/ai/search/retrieval-router";

describe("P8 & P9 LLM Wiki - Synthesized Knowledge Layer (wiki-store)", () => {
  it("provides comprehensive pre-seeded project and architecture wiki overviews", () => {
    const allPages = listAllWikiPages();
    expect(allPages.length).toBeGreaterThanOrEqual(4);

    const wifiCamWiki = getWikiPageBySlug("project-wifi-camera");
    expect(wifiCamWiki).toBeDefined();
    expect(wifiCamWiki?.title).toContain("wifi相机");
    expect(wifiCamWiki?.summary).toContain("Skynex");
    expect(wifiCamWiki?.keyModules.length).toBeGreaterThanOrEqual(3);
    expect(wifiCamWiki?.relatedTickets.some((t) => t.ticketNo === 10010)).toBe(
      true,
    );

    // Retains source evidence references
    expect(wifiCamWiki?.sourceEvidence.length).toBeGreaterThanOrEqual(2);
    expect(
      wifiCamWiki?.sourceEvidence.some((se) => se.title.includes("10010")),
    ).toBe(true);
  });

  it("converts wiki page to standard retrieval evidence preserving source citations", () => {
    const coldCamWiki = getWikiPageBySlug("project-cold-camera")!;
    const evidence = wikiPageToEvidence(coldCamWiki);

    expect(evidence.channel).toBe("wiki");
    expect(evidence.title).toContain("冷冻相机");
    expect(evidence.content).toContain("TEC 半导体");

    // Preserves bidirectional links in paths and metadata
    expect(evidence.paths?.length).toBeGreaterThan(0);
    expect(evidence.paths?.[0]).toContain("-[SYNTHESIZED_FROM]->");
    const meta = evidence.metadata as Record<string, unknown> | null;
    expect(
      Array.isArray(meta?.sourceEvidence) && meta.sourceEvidence.length > 0,
    ).toBe(true);
  });
});

describe("P8 Dynamic Database Synthesis & SearchDocument Indexing", () => {
  it("dynamically synthesizes WikiPage from live business models and updates when tickets change", async () => {
    const mockDb: WikiDatabaseClient = {
      project: {
        findUnique: vi.fn().mockResolvedValue({
          id: "proj_dynamic_1",
          name: "智能寻星仪",
          status: "ACTIVE",
          owner: { id: "u1", name: "张工程师", email: "zhang@example.com" },
          responsibilities: [
            {
              modules: [
                {
                  id: "mod_motor",
                  name: "高精度电机驱动模块",
                  tickets: [
                    {
                      id: "t_10099",
                      ticketNo: 10099,
                      title: "双轴电机PWM脉冲发生器校准",
                      status: "IN_PROGRESS",
                      priority: 1,
                      commits: [
                        {
                          id: "c1",
                          commitSha: "a1b2c3d4",
                          subject: "fix: 电机失步问题排查",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
      pkmNote: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "note_spec_1", title: "寻星仪电机通信协议规范" },
          ]),
      },
      searchDocument: {
        upsert: vi.fn().mockResolvedValue({ id: "search_doc_wiki_1" }),
      },
    };

    // 1. Synthesize project wiki
    const wiki = await synthesizeProjectWiki("proj_dynamic_1", { db: mockDb });
    expect(wiki).toBeDefined();
    expect(wiki?.title).toBe("《智能寻星仪 项目研发全貌与技术架构总览》");
    expect(wiki?.keyModules[0].name).toBe("高精度电机驱动模块");
    expect(wiki?.relatedTickets[0].ticketNo).toBe(10099);

    // Verify source evidence retention
    expect(wiki?.sourceEvidence.some((se) => se.title.includes("10099"))).toBe(
      true,
    );
    expect(
      wiki?.sourceEvidence.some((se) => se.title.includes("电机失步")),
    ).toBe(true);
    expect(
      wiki?.sourceEvidence.some((se) => se.title.includes("协议规范")),
    ).toBe(true);

    // 2. Index into SearchDocument
    const syncRes = await syncWikiPageToSearchDocument(wiki!, { db: mockDb });
    expect(syncRes.id).toBe("search_doc_wiki_1");
    expect(mockDb.searchDocument?.upsert).toHaveBeenCalled();
  });
});

describe("P9 Wiki Retriever - searchWikiCandidates", () => {
  it("directly resolves project overview query to synthesized wiki page with underlying source citations", async () => {
    const plan = understandQuery("总结 wifi相机 项目的研发全貌与关键模块");
    const candidates = await searchWikiCandidates(plan, plan.subject);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const top = candidates[0];
    expect(top.channel).toBe("wiki");
    expect(top.title).toContain("wifi相机");
    expect(top.content).toContain("Skynex");

    // Must preserve underlying raw evidence
    const meta = top.metadata as Record<string, unknown>;
    expect(meta.isWiki).toBe(true);
    expect(meta.slug).toBe("project-wifi-camera");
    const sources = meta.sourceEvidence as Array<{ title: string }>;
    expect(sources.some((s) => s.title.includes("10010"))).toBe(true);
  });

  it("resolves architecture overview queries to synthesized architecture wiki page", async () => {
    const plan = understandQuery("总结 ProjectHub RAG 检索架构与图谱全貌");
    const candidates = await searchWikiCandidates(plan, "rag");

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const top = candidates[0];
    expect(top.title).toContain("ProjectHub RAG");
    expect(top.content).toContain("PostgreSQL");
    expect(top.content).toContain("GraphRAG");

    // Preserves citations to PKM guides
    const meta = top.metadata as Record<string, unknown>;
    const sources = meta.sourceEvidence as Array<{ title: string }>;
    expect(sources.some((s) => s.title.includes("PKM"))).toBe(true);
  });
});

describe("P9 Router & Wiki Integration", () => {
  it("routes SUMMARY intent to WIKI and executes wiki lane", async () => {
    const plan = understandQuery("总结一下寻星望远镜项目的全貌与进展");
    expect(decideRetrievalRoute(plan)).toBe("WIKI");

    const mockWiki = vi.fn(async () => [
      wikiPageToEvidence(getWikiPageBySlug("project-telescope")!),
    ]);

    const deps = {
      structured: vi.fn(async () => []),
      hybrid: vi.fn(async () => []),
      graph: vi.fn(async () => []),
      wiki: mockWiki,
      timeoutMs: 2000,
    };

    const report = await executeRetrievalPlan(plan, deps);

    expect(report.route).toBe("WIKI");
    expect(mockWiki).toHaveBeenCalled();
    expect(report.evidence.length).toBe(1);
    expect(report.evidence[0].channel).toBe("wiki");
    expect(report.evidence[0].title).toContain("寻星望远镜");
  });
});
