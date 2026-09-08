import { describe, it, expect } from "vitest";
import { understandQuery } from "./query-understanding";
import { evaluateEvidence } from "./evidence-evaluator";
import type { Evidence } from "./retrieval-router";

function mockEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    type: "ticket",
    title: "工单标题",
    content: "这是有效工单内容描述",
    url: "/tickets/t1",
    channel: "structured",
    ...overrides,
  };
}

describe("evaluateEvidence", () => {
  it("classifies SUFFICIENT when core requested types are covered", () => {
    const plan = understandQuery("光污染设计涉及哪些工单");
    const evidence = [
      mockEvidence({ id: "t1", type: "ticket", title: "#10010 光污染处理" }),
      mockEvidence({
        id: "n1",
        type: "note",
        title: "光污染设计需求文档",
        url: "/pkm/notes/n1",
      }),
    ];
    const evaluation = evaluateEvidence(plan, evidence);

    expect(evaluation.status).toBe("SUFFICIENT");
    expect(evaluation.score).toBeGreaterThanOrEqual(0.8);
    expect(evaluation.reason).toContain("充沛");
  });

  it("classifies INSUFFICIENT with helpful fallback suggestions when no usable evidence is found", () => {
    const plan = understandQuery("光污染相关的某些未知事物");
    const evaluation = evaluateEvidence(plan, []);

    expect(evaluation.status).toBe("INSUFFICIENT");
    expect(evaluation.score).toBe(0.0);
    expect(evaluation.suggestions.length).toBeGreaterThan(0);
    expect(evaluation.reason).toContain("未检索到");
  });

  it("classifies WEAK and suggests missing types when explicit requested types are not covered", () => {
    const plan = understandQuery("光污染的工单和笔记有哪些");
    // Only tickets found, notes are missing
    const evidence = [
      mockEvidence({ id: "t1", type: "ticket", title: "#10010 光污染测试" }),
      mockEvidence({ id: "t2", type: "ticket", title: "#10011 光污染排查" }),
    ];
    const evaluation = evaluateEvidence(plan, evidence);

    expect(evaluation.status).toBe("WEAK");
    expect(evaluation.score).toBeLessThan(0.8);
    expect(evaluation.coverage.missingTypes).toContain("note");
    // Suggestion specifically asks for missing note
    expect(evaluation.suggestions.some((s) => s.type === "note")).toBe(true);
  });

  it("classifies AMBIGUOUS when multiple distinct entities are matched for a lookup", () => {
    const plan = understandQuery("查看光污染");
    plan.intent = "lookup";
    const evidence = [
      mockEvidence({
        id: "p1",
        type: "project",
        title: "光污染计",
        url: "/projects/p1",
      }),
      mockEvidence({
        id: "n1",
        type: "note",
        title: "光污染设计需求文档",
        url: "/pkm/notes/n1",
      }),
      mockEvidence({ id: "t1", type: "ticket", title: "#10018 传感器联调" }),
    ];
    const evaluation = evaluateEvidence(plan, evidence);

    expect(evaluation.status).toBe("AMBIGUOUS");
    expect(evaluation.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(
      evaluation.suggestions.some((s) => s.label.includes("光污染计")),
    ).toBe(true);
    expect(
      evaluation.suggestions.some((s) =>
        s.label.includes("光污染设计需求文档"),
      ),
    ).toBe(true);
  });
});
