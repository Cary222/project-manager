import { describe, expect, it, vi, beforeEach } from "vitest";
import { evaluatePlanExecution } from "./evaluator";
import type { ValidatedStep, StepRecord } from "../runtime/work-run-store";

vi.mock("@/features/ai/llm/summarizer", () => ({
  callAgnes: vi.fn(),
}));

import { callAgnes } from "@/features/ai/llm/summarizer";

const mockCallAgnes = vi.mocked(callAgnes);

function mockStep(id: string): ValidatedStep {
  return {
    id,
    action: `动作 ${id}`,
    description: `描述 ${id}`,
    tool: "business_query",
    args: {},
    dependsOn: [],
    requiresActionApproval: false,
  };
}

function mockRecord(
  id: string,
  status: StepRecord["status"] = "done",
): StepRecord {
  return {
    stepId: id,
    planVersion: 1,
    status,
    attempts: 1,
  };
}

describe("evaluatePlanExecution (C10 Evaluator)", () => {
  beforeEach(() => {
    mockCallAgnes.mockReset();
  });

  it("当产物完备且符合预期时，评估判定为 done", async () => {
    mockCallAgnes.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: "done",
        reason: "数据查询完整，归因逻辑清晰且客观说明了数据边界",
        observed: ["已查询历史状态记录", "已产出 Markdown 复盘报告"],
      }),
    });

    const res = await evaluatePlanExecution({
      userId: "u1",
      goal: "统计上个月延期工单",
      steps: [mockStep("s1"), mockStep("s2")],
      stepResults: { s1: mockRecord("s1"), s2: mockRecord("s2") },
      stepOutputs: { s1: { total: 10 }, s2: "# 报告内容" },
    });

    expect(res.verdict).toBe("done");
    expect(res.reason).toContain("归因逻辑清晰");
    expect(res.observed).toHaveLength(2);
    expect(typeof res.at).toBe("number");
  });

  it("当 LLM 判定缺失关键交付物时，评估判定为 replan", async () => {
    mockCallAgnes.mockResolvedValueOnce({
      content: JSON.stringify({
        verdict: "replan",
        reason: "缺少核心报告生成步骤，仅执行了原始数据拉取",
        observed: ["数据已获取", "未生成总结报告"],
      }),
    });

    const res = await evaluatePlanExecution({
      userId: "u1",
      goal: "统计延期工单并产出复盘报告",
      steps: [mockStep("s1")],
      stepResults: { s1: mockRecord("s1") },
      stepOutputs: { s1: { total: 10 } },
    });

    expect(res.verdict).toBe("replan");
    expect(res.reason).toContain("缺少核心报告");
  });

  it("当评估器调用异常时，全 done 计划安全降级为 done", async () => {
    mockCallAgnes.mockRejectedValueOnce(new Error("LLM timeout"));

    const res = await evaluatePlanExecution({
      userId: "u1",
      goal: "统计延期工单",
      steps: [mockStep("s1")],
      stepResults: { s1: mockRecord("s1", "done") },
      stepOutputs: { s1: "ok" },
    });

    expect(res.verdict).toBe("done");
    expect(res.reason).toContain("所有规划步骤均顺利执行完成");
  });
});
