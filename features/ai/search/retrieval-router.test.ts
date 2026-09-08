import { describe, it, expect, vi } from "vitest";
import { understandQuery } from "./query-understanding";
import {
  executeRetrievalPlan,
  checkEvidence,
  decideRetrievalRoute,
  retrievalContextText,
  type Evidence,
} from "./retrieval-router";

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    type: "ticket",
    title: "T",
    content: "body",
    url: "/tickets/1",
    channel: "structured",
    ...overrides,
  };
}

describe("P2 Retrieval Router - Route Selection (decideRetrievalRoute)", () => {
  it("routes COUNT and STATUS queries to STRUCTURED", () => {
    const planCount = understandQuery("未完成的工单有多少个？");
    expect(decideRetrievalRoute(planCount)).toBe("STRUCTURED");

    const planStatus = understandQuery("工单目前什么状态？是否完成？");
    expect(decideRetrievalRoute(planStatus)).toBe("STRUCTURED");
  });

  it("routes explicit ticket ID lookup to STRUCTURED", () => {
    const planTicket = understandQuery("#10010");
    expect(decideRetrievalRoute(planTicket)).toBe("STRUCTURED");
  });

  it("routes single-person RECENT_ACTIVITY to STRUCTURED", () => {
    const planActivity = understandQuery("刘工最近提交了什么？");
    expect(decideRetrievalRoute(planActivity)).toBe("STRUCTURED");
  });

  it("routes SUMMARY to WIKI", () => {
    const planSummary = understandQuery("总结一下寻星望远镜项目的全貌与进展");
    expect(decideRetrievalRoute(planSummary)).toBe("WIKI");
  });

  it("routes SEARCH and EXPLAIN queries to HYBRID", () => {
    const planSearch = understandQuery("查找相关的技术设计资料");
    expect(decideRetrievalRoute(planSearch)).toBe("HYBRID");

    const planExplain = understandQuery("为什么会出现相机偏亮的原因与机理？");
    expect(decideRetrievalRoute(planExplain)).toBe("HYBRID");
  });

  it("routes multi-hop RELATION and multi-entity queries to MIX", () => {
    const planRelation = understandQuery("光污染设计涉及哪些站内信息？");
    expect(decideRetrievalRoute(planRelation)).toBe("MIX");

    const planCompare = understandQuery("对比 wifi相机 和 冷冻相机的差异");
    expect(decideRetrievalRoute(planCompare)).toBe("MIX");
  });
});

describe("P2 Retrieval Router - Execution & Safe Degradation", () => {
  it("executes STRUCTURED lane directly when routed to STRUCTURED", async () => {
    const plan = understandQuery("#10010");
    const deps = {
      structured: vi.fn(async () => [
        evidence({ id: "s1", type: "ticket", channel: "structured" }),
      ]),
      hybrid: vi.fn(async () => []),
      graph: vi.fn(async () => []),
      timeoutMs: 2000,
    };

    const report = await executeRetrievalPlan(plan, deps);
    expect(report.route).toBe("STRUCTURED");
    expect(deps.structured).toHaveBeenCalled();
    expect(deps.graph).not.toHaveBeenCalled();
    expect(deps.hybrid).not.toHaveBeenCalled();
    expect(report.fallbackOccurred).toBeFalsy();
    expect(report.evidence.length).toBe(1);
  });

  it("safely degrades to HYBRID when STRUCTURED lane throws an error", async () => {
    const plan = understandQuery("#10010");
    const deps = {
      structured: vi.fn(async () => {
        throw new Error("Database connection lost");
      }),
      hybrid: vi.fn(async () => [
        evidence({
          id: "h1",
          type: "ticket",
          title: "#10010 备份",
          channel: "hybrid",
        }),
      ]),
      graph: vi.fn(async () => []),
      timeoutMs: 2000,
    };

    const report = await executeRetrievalPlan(plan, deps);
    expect(report.route).toBe("STRUCTURED");
    expect(deps.structured).toHaveBeenCalled();
    expect(deps.hybrid).toHaveBeenCalled();
    expect(report.fallbackOccurred).toBe(true);
    expect(report.fallbackReason).toContain("safely downgraded to Hybrid");
    expect(report.evidence.some((e) => e.channel === "hybrid")).toBe(true);
  });

  it("safely degrades to HYBRID when STRUCTURED lane returns empty results", async () => {
    const plan = understandQuery("工单 #10010 目前什么状态？");
    const deps = {
      structured: vi.fn(async () => []),
      hybrid: vi.fn(async () => [
        evidence({
          id: "h1",
          type: "ticket",
          title: "工单说明文档",
          channel: "hybrid",
        }),
      ]),
      graph: vi.fn(async () => []),
      timeoutMs: 2000,
    };

    const report = await executeRetrievalPlan(plan, deps);
    expect(report.route).toBe("STRUCTURED");
    expect(report.fallbackOccurred).toBe(true);
    expect(report.evidence.length).toBe(1);
    expect(report.evidence[0].id).toBe("h1");
  });

  it("safely degrades to HYBRID when WIKI retriever is not provided", async () => {
    const plan = understandQuery("总结项目全貌");
    const deps = {
      structured: vi.fn(async () => []),
      hybrid: vi.fn(async () => [
        evidence({
          id: "h_doc",
          type: "note",
          title: "项目总览文档",
          channel: "hybrid",
        }),
      ]),
      graph: vi.fn(async () => []),
      timeoutMs: 2000,
    };

    const report = await executeRetrievalPlan(plan, deps);
    expect(report.route).toBe("WIKI");
    expect(deps.hybrid).toHaveBeenCalled();
    expect(report.evidence.length).toBe(1);
  });

  it("runs MIX with all lanes in parallel and survives single lane failure", async () => {
    const plan = understandQuery("光污染设计涉及哪些工单和笔记");
    const deps = {
      structured: vi.fn(async () => [
        evidence({ id: "s1", type: "ticket", channel: "structured" }),
      ]),
      hybrid: vi.fn(async () => [
        evidence({ id: "h1", type: "note", channel: "hybrid" }),
      ]),
      graph: vi.fn(async () => {
        throw new Error("Graph CTE error");
      }),
      timeoutMs: 2000,
    };

    const report = await executeRetrievalPlan(plan, deps);
    expect(report.route).toBe("MIX");
    expect(deps.structured).toHaveBeenCalled();
    expect(deps.hybrid).toHaveBeenCalled();
    expect(deps.graph).toHaveBeenCalled();
    expect(report.evidence.length).toBe(2);
    expect(
      report.attempts.some(
        (a) => a.retriever === "graph" && a.status === "failed",
      ),
    ).toBe(true);
  });

  it("renders route and fallback notes in retrievalContextText", async () => {
    const plan = understandQuery("#10010");
    const deps = {
      structured: vi.fn(async () => {
        throw new Error("Timeout");
      }),
      hybrid: vi.fn(async () => [
        evidence({
          id: "h1",
          type: "ticket",
          title: "#10010 备份",
          channel: "hybrid",
        }),
      ]),
      graph: vi.fn(async () => []),
    };

    const report = await executeRetrievalPlan(plan, deps);
    const text = retrievalContextText(report);
    expect(text).toContain("选路模式：STRUCTURED");
    expect(text).toContain("容灾降级：已触发安全降级");
  });
});

describe("checkEvidence", () => {
  it("enough when all requested types covered", () => {
    const plan = understandQuery("光污染设计涉及哪些工单");
    const result = checkEvidence(plan, [
      evidence({ type: "ticket" }),
      evidence({ id: "n1", type: "note" }),
      evidence({ id: "p1", type: "project" }),
    ]);
    expect(result.enough).toBe(true);
  });

  it("not enough when a requested type is missing", () => {
    const plan = understandQuery("光污染项目的工单和笔记");
    const result = checkEvidence(plan, [evidence({ type: "ticket" })]);
    expect(result.enough).toBe(false);
    expect(result.missingTypes).toContain("note");
  });

  it("rejects items with empty content or absolute external urls", () => {
    const plan = understandQuery("测试");
    const result = checkEvidence(plan, [
      evidence({ content: "" }),
      evidence({ url: "https://example.com" }),
    ]);
    expect(result.enough).toBe(false);
  });
});

describe("executeRetrievalPlan - Rewrite & Web Gating", () => {
  it("retries with rewrite when first round is empty", async () => {
    const plan = understandQuery("光污染设计涉及哪些工单");
    let callCount = 0;
    const deps = {
      structured: vi.fn(async () => {
        callCount++;
        return callCount > 1
          ? [
              evidence({ type: "ticket" }),
              evidence({ id: "n1", type: "note" }),
              evidence({ id: "p1", type: "project" }),
            ]
          : [];
      }),
      hybrid: vi.fn(async () => []),
      graph: vi.fn(async () => []),
      timeoutMs: 2000,
    };
    const report = await executeRetrievalPlan(plan, deps);
    expect(report.rewritten).toBe(true);
    expect(callCount).toBe(2);
  });

  it("allows web only when scope is WEB_ALLOWED and evidence insufficient after rewrite", async () => {
    const plan = understandQuery("今天北京天气怎么样");
    plan.scope = "WEB_ALLOWED";
    const deps = {
      structured: vi.fn(async () => []),
      hybrid: vi.fn(async () => []),
      graph: vi.fn(async () => []),
      timeoutMs: 2000,
    };
    const report = await executeRetrievalPlan(plan, deps);
    expect(report.allowWeb).toBe(true);
    expect(report.rewritten).toBe(true);
  });
});
