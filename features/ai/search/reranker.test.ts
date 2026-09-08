import { describe, it, expect } from "vitest";
import { rerankCandidates } from "./reranker";
import type { Evidence } from "./retrieval-router";

function createCandidate(overrides: Partial<Evidence>): Evidence {
  return {
    id: "c1",
    type: "ticket",
    title: "默认标题",
    content: "默认正文内容",
    url: "/tickets/c1",
    channel: "hybrid",
    ...overrides,
  };
}

describe("P3 Semantic Reranker - Noise Suppression & Top-5 Ranking", () => {
  it("effectively demotes and filters out spurious unrelated noise", () => {
    const query = "光污染设计涉及哪些工单和笔记";
    const subject = "光污染";

    const candidates: Evidence[] = [
      // Spurious noise: FlashStorage commit that accidentally matched an isolated single character
      createCandidate({
        id: "noisy_commit_1",
        type: "commit",
        title:
          "c4c1d176 #10032 feat: Enhance FlashStorage functionality with debugging features",
        content:
          "Added functions to print individual records and dump sector data for debugging purposes.",
        url: "/tickets/10032",
        channel: "hybrid",
      }),
      // Genuine matching note
      createCandidate({
        id: "genuine_note_1",
        type: "note",
        title: "光污染设计需求文档",
        content: "本设计文档详述光污染计的硬件结构、传感器选型与采集协议。",
        url: "/pkm/notes/note_1",
        channel: "hybrid",
      }),
      // Genuine matching project
      createCandidate({
        id: "genuine_proj_1",
        type: "project",
        title: "光污染计",
        content: "项目管理下负责光污染计整机研发的子项目。",
        url: "/projects/proj_1",
        channel: "structured",
      }),
      // Related ticket with graph paths
      createCandidate({
        id: "genuine_ticket_1",
        type: "ticket",
        title: "#10018 光污染传感器校准",
        content: "校准光电二极管响应曲线。",
        url: "/tickets/ticket_1",
        channel: "graph",
        paths: ["#10018 -[BELONGS_TO]-> 光污染计"],
      }),
      // Another unrelated item
      createCandidate({
        id: "noisy_ticket_2",
        type: "ticket",
        title: "#10045 优化蓝牙连接超时重试",
        content: "修改 BLE 状态机重连策略。",
        url: "/tickets/ticket_45",
        channel: "hybrid",
      }),
    ];

    const results = rerankCandidates(query, candidates, {
      subject,
      explicitTypes: ["ticket", "note"],
      topK: 5,
      minScore: 0.25,
    });

    // 1. Noise items should be filtered or pushed to the bottom
    const topResultIds = results.map((r) => r.item.id);
    expect(topResultIds).not.toContain("noisy_commit_1");
    expect(topResultIds).not.toContain("noisy_ticket_2");

    // 2. High relevance items should occupy the top spots
    expect(results[0].item.title).toContain("光污染");
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.6);

    // 3. Top results are all genuine relevant items
    expect(results.every((r) => r.item.title.includes("光污染"))).toBe(true);
  });

  it("boosts exact title matches over body-only matches", () => {
    const query = "寻星望远镜";
    const candidates: Evidence[] = [
      createCandidate({
        id: "body_only",
        title: "关于某项日常杂记",
        content: "今天在实验室简单测试了寻星望远镜的视场角度。",
      }),
      createCandidate({
        id: "title_match",
        title: "寻星望远镜项目概述与规划",
        content: "这是项目的核心文档大纲。",
      }),
    ];

    const results = rerankCandidates(query, candidates, {
      subject: "寻星望远镜",
    });
    expect(results[0].item.id).toBe("title_match");
    expect(results[0].reasons).toContain("标题包含完整查询主题");
  });

  it("prioritizes structured verified facts and graph paths", () => {
    const query = "冷冻相机";
    const candidates: Evidence[] = [
      createCandidate({
        id: "hybrid_item",
        title: "冷冻相机文档",
        content: "相机的文本说明",
        channel: "hybrid",
      }),
      createCandidate({
        id: "structured_item",
        title: "冷冻相机项目",
        content: "结构化数据库事实",
        channel: "structured",
      }),
      createCandidate({
        id: "graph_item",
        title: "冷冻相机核心模块",
        content: "具备图谱关系",
        channel: "graph",
        paths: ["冷冻相机 -[HAS_MODULE]-> MCU"],
      }),
    ];

    const results = rerankCandidates(query, candidates, {
      subject: "冷冻相机",
    });
    const structuredResult = results.find(
      (r) => r.item.id === "structured_item",
    );
    const graphResult = results.find((r) => r.item.id === "graph_item");

    expect(structuredResult?.reasons).toContain("结构化业务事实优先");
    expect(
      graphResult?.reasons.some((r) => r.includes("图谱关系路径支撑")),
    ).toBe(true);
  });

  it("favors explicitly requested entity types", () => {
    const query = "光污染的工单";
    const candidates: Evidence[] = [
      createCandidate({
        id: "note_item",
        type: "note",
        title: "光污染需求说明",
        content: "说明内容",
      }),
      createCandidate({
        id: "ticket_item",
        type: "ticket",
        title: "#10018 光污染传感器",
        content: "工单内容",
      }),
    ];

    const results = rerankCandidates(query, candidates, {
      subject: "光污染",
      explicitTypes: ["ticket"],
    });

    // Both match "光污染", but ticket_item matches explicitTypes: ["ticket"]
    expect(results[0].item.id).toBe("ticket_item");
    expect(results[0].reasons).toContain("符合显式请求类型「ticket」");
  });

  it("executes lightweight reranking in under 15ms for 50 items", () => {
    const candidates: Evidence[] = Array.from({ length: 50 }, (_, i) =>
      createCandidate({
        id: `c_${i}`,
        title: `系统工单 #${10000 + i} ${i % 3 === 0 ? "光污染相关" : "通用日常维护"}`,
        content: `这是第 ${i} 项描述，包含部分技术内容说明。`,
      }),
    );

    const start = performance.now();
    const results = rerankCandidates("光污染", candidates, { topK: 10 });
    const elapsed = performance.now() - start;

    expect(results.length).toBeLessThanOrEqual(10);
    expect(elapsed).toBeLessThan(15);
  });
});
