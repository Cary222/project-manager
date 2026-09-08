import { describe, it, expect, vi } from "vitest";
import {
  understandQuery,
  understandQueryWithEntities,
  detectFineGrainedIntent,
  resolveQueryScope,
  calculateAmbiguity,
  resolveEntityBindings,
  rewriteSubject,
  isIntent,
  type EntityBinding,
  type DatabaseClient,
} from "./query-understanding";

describe("P1 Query Understanding - Fine-Grained Intent Classification", () => {
  it("classifies COUNT queries correctly", () => {
    const plan = understandQuery("未完成的工单有多少个？");
    expect(plan.fineGrainedIntent).toBe("COUNT");
    expect(isIntent(plan, "COUNT")).toBe(true);
    expect(plan.intent).toBe("lookup"); // backward-compatible legacy mapping
  });

  it("classifies STATUS queries correctly", () => {
    const plan = understandQuery("工单 #10010 目前什么状态？进展如何？");
    expect(plan.fineGrainedIntent).toBe("STATUS");
    expect(plan.entityHints.ticketNo).toBe(10010);
  });

  it("classifies TIMELINE queries correctly", () => {
    const plan = understandQuery("冷冻相机项目近期的历史演进时间线");
    expect(plan.fineGrainedIntent).toBe("TIMELINE");
    expect(isIntent(plan, "activity")).toBe(true);
  });

  it("classifies RECENT_ACTIVITY queries correctly", () => {
    const plan = understandQuery("刘工这周提交了什么？");
    expect(plan.fineGrainedIntent).toBe("RECENT_ACTIVITY");
    expect(isIntent(plan, "RECENT_ACTIVITY")).toBe(true);
    expect(plan.requestedTypes).toContain("commit");
    expect(plan.requestedTypes).toContain("person");
  });

  it("classifies SUMMARY queries correctly", () => {
    const plan = understandQuery("总结一下寻星望远镜项目的全貌与进展");
    expect(plan.fineGrainedIntent).toBe("SUMMARY");
  });

  it("classifies COMPARE queries correctly", () => {
    const plan = understandQuery("对比 wifi相机 和 冷冻相机的差异");
    expect(plan.fineGrainedIntent).toBe("COMPARE");
  });

  it("classifies EXPLAIN queries correctly", () => {
    const plan = understandQuery("为什么会出现相机偏亮的原因与机理？");
    expect(plan.fineGrainedIntent).toBe("EXPLAIN");
  });

  it("classifies RELATION queries correctly", () => {
    const plan = understandQuery("光污染设计涉及哪些站内信息？");
    expect(plan.fineGrainedIntent).toBe("RELATION");
    expect(plan.scope).toBe("INTERNAL_ONLY");
    expect(plan.requestedTypes.length).toBeGreaterThanOrEqual(3);
  });

  it("classifies LOOKUP queries with exact ticket ID", () => {
    const plan = understandQuery("#10016");
    expect(plan.fineGrainedIntent).toBe("LOOKUP");
    expect(plan.entityHints.ticketNo).toBe(10016);
  });

  it("classifies CONVERSATION queries correctly", () => {
    const plan = understandQuery("你好呀，在吗！");
    expect(plan.fineGrainedIntent).toBe("CONVERSATION");
    expect(plan.needsStructured).toBe(false);
    expect(plan.needsHybrid).toBe(false);
  });

  it("classifies EXTERNAL queries correctly", () => {
    const plan = understandQuery("今天北京气温多少度？");
    expect(plan.fineGrainedIntent).toBe("EXTERNAL");
    expect(plan.scope).toBe("WEB_ALLOWED");
  });
});

describe("P1 Query Understanding - Scope & Protection", () => {
  it("enforces INTERNAL_ONLY when query contains internal keywords", () => {
    expect(resolveQueryScope("请在站内查询关于光污染的笔记")).toBe(
      "INTERNAL_ONLY",
    );
    expect(resolveQueryScope("本系统内的工单列表")).toBe("INTERNAL_ONLY");
    expect(resolveQueryScope("项目内是否有相关文档")).toBe("INTERNAL_ONLY");
  });

  it("assigns WEB_ALLOWED for explicit external keywords", () => {
    expect(resolveQueryScope("联网搜索最新技术资讯")).toBe("WEB_ALLOWED");
    expect(resolveQueryScope("今天上海天气")).toBe("WEB_ALLOWED");
  });

  it("defaults to INTERNAL_FIRST for standard domain queries", () => {
    expect(resolveQueryScope("整理冷冻相机环境")).toBe("INTERNAL_FIRST");
  });
});

describe("P1 Query Understanding - Ambiguity Detection & Scoring", () => {
  it("scores 0.0 ambiguity for single exact match", () => {
    const bindings: EntityBinding[] = [
      {
        entityType: "ticket",
        id: "t1",
        name: "#10010",
        matchType: "exact",
        confidence: 1.0,
      },
    ];
    const amb = calculateAmbiguity("#10010", bindings, "LOOKUP");
    expect(amb.isAmbiguous).toBe(false);
    expect(amb.score).toBe(0.0);
    expect(amb.reason).toContain("唯一实体");
  });

  it("detects high ambiguity (>= 0.7) when multiple entities match with close confidence", () => {
    const bindings: EntityBinding[] = [
      {
        entityType: "project",
        id: "p1",
        name: "光污染计",
        matchType: "fuzzy",
        confidence: 0.85,
      },
      {
        entityType: "note",
        id: "n1",
        name: "光污染设计需求文档",
        matchType: "fuzzy",
        confidence: 0.8,
      },
    ];
    const amb = calculateAmbiguity("光污染", bindings, "LOOKUP");
    expect(amb.isAmbiguous).toBe(true);
    expect(amb.score).toBeGreaterThanOrEqual(0.7);
    expect(amb.candidateEntities.length).toBe(2);
    expect(amb.reason).toContain("同时匹配到多个相近候选实体");
  });

  it("identifies clear winner without ambiguity when one candidate dominates", () => {
    const bindings: EntityBinding[] = [
      {
        entityType: "project",
        id: "p1",
        name: "寻星望远镜",
        matchType: "exact",
        confidence: 1.0,
      },
      {
        entityType: "note",
        id: "n1",
        name: "随笔提到望远镜",
        matchType: "fuzzy",
        confidence: 0.5,
      },
    ];
    const amb = calculateAmbiguity("寻星望远镜", bindings, "LOOKUP");
    expect(amb.isAmbiguous).toBe(false);
    expect(amb.score).toBeLessThanOrEqual(0.3);
  });
});

describe("P1 Query Understanding - Database Entity Pre-resolution", () => {
  it("resolves entity bindings with mock database", async () => {
    const mockDb: DatabaseClient = {
      ticket: {
        findFirst: vi.fn().mockResolvedValue({
          id: "ticket_10010",
          ticketNo: 10010,
          title: "整理wifi相机云端环境",
          projectId: "proj_wifi",
        }),
      },
      project: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "proj_light", name: "光污染计" }]),
      },
      pkmNote: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: "note_light",
              title: "光污染设计需求文档",
              projectId: "proj_light",
            },
          ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const bindings = await resolveEntityBindings("光污染", { db: mockDb });
    expect(bindings.length).toBe(2);

    const types = bindings.map((b) => b.entityType);
    expect(types).toContain("project");
    expect(types).toContain("note");

    const plan = await understandQueryWithEntities("光污染", { db: mockDb });
    expect(plan.bindings?.length).toBe(2);
    expect(plan.ambiguity).toBeDefined();
    expect(plan.ambiguity?.isAmbiguous).toBe(true);
  });

  it("extracts clean subject and provides segmented rewrite", () => {
    const plan = understandQuery(
      "麻烦帮我查一下关于光污染设计涉及哪些站内信息",
    );
    expect(plan.subject).toContain("光污染");
    const rewritten = rewriteSubject(plan);
    expect(rewritten).toBeTruthy();
    expect(rewritten).not.toContain("请帮我");
    expect(rewritten).not.toContain("有哪些");
  });
});
