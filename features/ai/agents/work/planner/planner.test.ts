import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLPlanner, topologicalSort, hasCycle, type WorkStep } from "./planner";

// Mock callAgnes
vi.mock("@/features/ai/llm/summarizer", () => ({
  callAgnes: vi.fn(),
}));

import { callAgnes } from "@/features/ai/llm/summarizer";
const mockCallAgnes = vi.mocked(callAgnes);

const GOAL = {
  id: "test-1",
  type: "custom",
  description: "统计 A 项目未关闭工单并生成报告",
  createdAt: new Date().toISOString(),
};

describe("LLPlanner.plan()", () => {
  const planner = new LLPlanner();

  beforeEach(() => {
    mockCallAgnes.mockReset();
  });

  it("正常多步拆解", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        steps: [
          { id: "s1", action: "query_tickets", description: "查询未关闭工单", tool: "business_query", args: { entity: "ticket" }, dependsOn: [] },
          { id: "s2", action: "generate_report", description: "生成汇总报告", tool: "business_report", args: { title: "汇总", question: "工单情况", sourceStepIds: ["s1"] }, dependsOn: ["s1"] },
        ],
      }),
      model: "test",
    });

    const plan = await planner.plan(GOAL, { userId: "u1" });

    expect(plan.steps.length).toBe(2);
    expect(plan.requiresApproval).toBe(true);
    expect(plan.estimatedSteps).toBe(2);
    expect(plan.steps[0].id).toBe("s1");
    expect(plan.steps[1].id).toBe("s2");
    expect(plan.steps[1].dependsOn).toEqual(["s1"]);
  });

  it("dependsOn 含悬空 id 被剔除", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        steps: [
          { id: "s1", action: "a", description: "d1", tool: "business_query", args: { entity: "ticket" }, dependsOn: [] },
          { id: "s2", action: "b", description: "d2", tool: "generate_text", args: { instruction: "x" }, dependsOn: ["s1", "nonexistent"] },
        ],
      }),
      model: "test",
    });

    const plan = await planner.plan(GOAL);

    expect(plan.steps.length).toBe(2);
    // "nonexistent" should have been stripped
    expect(plan.steps[1].dependsOn).toEqual(["s1"]);
  });

  it("dependsOn 成环退回单步计划", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        steps: [
          { id: "s1", action: "a", description: "d1", tool: "business_query", args: { entity: "ticket" }, dependsOn: ["s2"] },
          { id: "s2", action: "b", description: "d2", tool: "generate_text", args: { instruction: "x" }, dependsOn: ["s1"] },
        ],
      }),
      model: "test",
    });

    const plan = await planner.plan(GOAL);

    // Cycle detected → fallback to single step
    expect(plan.steps.length).toBe(1);
    expect(plan.requiresApproval).toBe(false);
  });

  it("步骤数超上限(8)时截断", async () => {
    const manySteps = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i + 1}`,
      action: `action_${i + 1}`,
      description: `step ${i + 1}`,
      tool: "generate_text",
      args: { instruction: `step ${i + 1}` },
      dependsOn: [],
    }));

    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({ steps: manySteps }),
      model: "test",
    });

    const plan = await planner.plan(GOAL);

    expect(plan.steps.length).toBeLessThanOrEqual(8);
  });

  it("LLM 异常退回单步降级（固定为无副作用的 generate_text，不做关键词路由）", async () => {
    mockCallAgnes.mockRejectedValue(new Error("Network error"));

    const queryGoal = {
      ...GOAL,
      description: "查询所有未关闭工单",
    };

    const plan = await planner.plan(queryGoal);

    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].tool).toBe("generate_text");
    // 降级步骤必须自带合法参数，否则执行期会因缺参数失败
    expect(plan.steps[0].args).toEqual({ instruction: queryGoal.description });
    expect(plan.requiresApproval).toBe(false);
  });

  it("幻觉工具名被 critic 拦下，不放行到执行期（C3）", async () => {
    // 历史缺陷：prompt 曾宣传 searchStructured/generateText，
    // LLM 于是稳定产出这两个不存在的工具名，执行期静默 no-op。
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        steps: [
          { id: "s1", action: "q", description: "查询工单", tool: "searchStructured", dependsOn: [] },
          { id: "s2", action: "r", description: "生成报告", tool: "generateText", dependsOn: ["s1"] },
        ],
      }),
      model: "test",
    });

    const plan = await planner.plan(GOAL);

    // 不得把幻觉工具放行
    expect(plan.steps.some((s) => s.tool === "searchStructured")).toBe(false);
    expect(plan.steps.some((s) => s.tool === "generateText")).toBe(false);
    // 退回降级单步，且该步骤工具必定在真实白名单内
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].tool).toBe("generate_text");
  });

  it("工具参数不合法时同样退回降级（缺必填参数不放行）", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        steps: [
          // business_query 缺 entity，business_report 缺 question/sourceStepIds
          { id: "s1", action: "q", description: "查询", tool: "business_query", dependsOn: [] },
        ],
      }),
      model: "test",
    });

    const plan = await planner.plan(GOAL);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].tool).toBe("generate_text");
  });
});

describe("hasCycle", () => {
  it("无环返回 false", () => {
    const steps: WorkStep[] = [
      { id: "a", action: "x", description: "x", dependsOn: [], status: "pending" },
      { id: "b", action: "x", description: "x", dependsOn: ["a"], status: "pending" },
    ];
    expect(hasCycle(steps)).toBe(false);
  });

  it("直接环返回 true", () => {
    const steps: WorkStep[] = [
      { id: "a", action: "x", description: "x", dependsOn: ["b"], status: "pending" },
      { id: "b", action: "x", description: "x", dependsOn: ["a"], status: "pending" },
    ];
    expect(hasCycle(steps)).toBe(true);
  });

  it("间接环返回 true", () => {
    const steps: WorkStep[] = [
      { id: "a", action: "x", description: "x", dependsOn: ["c"], status: "pending" },
      { id: "b", action: "x", description: "x", dependsOn: ["a"], status: "pending" },
      { id: "c", action: "x", description: "x", dependsOn: ["b"], status: "pending" },
    ];
    expect(hasCycle(steps)).toBe(true);
  });
});

describe("topologicalSort", () => {
  it("按依赖顺序排列", () => {
    const steps: WorkStep[] = [
      { id: "b", action: "x", description: "x", dependsOn: ["a"], status: "pending" },
      { id: "a", action: "x", description: "x", dependsOn: [], status: "pending" },
    ];
    const sorted = topologicalSort(steps);
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
  });
});
