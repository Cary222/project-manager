import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchByLLM, matchByKeyword, TemplateMatcher } from "./matcher";
import type { WorkflowTemplate } from "../workflows/registry";

// Mock callAgnes
vi.mock("@/features/ai/llm/summarizer", () => ({
  callAgnes: vi.fn(),
}));

import { callAgnes } from "@/features/ai/llm/summarizer";
const mockCallAgnes = vi.mocked(callAgnes);

const TEMPLATES: WorkflowTemplate[] = [
  {
    type: "weekly_report",
    name: "周报生成",
    description: "自动汇总本周工单、提交和进度，生成结构化周报",
    nodes: [],
    edges: [],
    initialState: {},
  },
  {
    type: "project_progress",
    name: "项目进展汇总",
    description: "汇总项目活跃工单、最新 Git 提交并生成核心指标与进展报告",
    nodes: [],
    edges: [],
    initialState: {},
  },
];

describe("matchByKeyword", () => {
  it("命中关键词时返回高置信度", () => {
    const result = matchByKeyword("帮我生成周报", TEMPLATES);
    expect(result.workflowId).toBe("weekly_report");
    expect(result.confidence).toBe(0.95);
    expect(result.matchedBy).toBe("keyword");
  });

  it("无关输入返回 null", () => {
    const result = matchByKeyword("今天天气怎么样", TEMPLATES);
    expect(result.workflowId).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

describe("matchByLLM", () => {
  beforeEach(() => {
    mockCallAgnes.mockReset();
  });

  it("语义变体命中返回正确 workflowId", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        workflowId: "weekly_report",
        confidence: 0.85,
        reason: "用户想整理进展给领导",
      }),
      model: "test",
    });

    const result = await matchByLLM(
      "帮我把这周的进展整理一份给领导",
      TEMPLATES,
      { userId: "u1" },
    );

    expect(result.workflowId).toBe("weekly_report");
    expect(result.confidence).toBe(0.85);
    expect(result.matchedBy).toBe("llm");
  });

  it("无关输入 LLM 返回 null", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        workflowId: null,
        confidence: 0.1,
        reason: "不属于任何工作流",
      }),
      model: "test",
    });

    const result = await matchByLLM("今天天气怎么样", TEMPLATES);
    expect(result.workflowId).toBeNull();
  });

  it("LLM 返回不存在的 workflowId（幻觉）被拦截", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        workflowId: "nonexistent_workflow",
        confidence: 0.9,
        reason: "幻觉",
      }),
      model: "test",
    });

    const result = await matchByLLM("做个分析", TEMPLATES);
    expect(result.workflowId).toBeNull();
    expect(result.reason).toContain("未知 workflowId");
  });

  it("LLM 返回 markdown 围栏包裹的 JSON 正确解析", async () => {
    mockCallAgnes.mockResolvedValue({
      content: '```json\n{"workflowId": "weekly_report", "confidence": 0.8, "reason": "test"}\n```',
      model: "test",
    });

    const result = await matchByLLM("整理周进展", TEMPLATES);
    expect(result.workflowId).toBe("weekly_report");
    expect(result.confidence).toBe(0.8);
  });

  it("LLM 抛异常时静默兜底", async () => {
    mockCallAgnes.mockRejectedValue(new Error("API timeout"));

    const result = await matchByLLM("随便说点什么", TEMPLATES);
    expect(result.workflowId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("confidence 超过 1 时归一化到 1", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        workflowId: "weekly_report",
        confidence: 1.5,
        reason: "test",
      }),
      model: "test",
    });

    const result = await matchByLLM("周报", TEMPLATES);
    expect(result.confidence).toBe(1);
  });
});

describe("TemplateMatcher", () => {
  beforeEach(() => {
    mockCallAgnes.mockReset();
  });

  it("关键词命中时不调 LLM", async () => {
    const matcher = new TemplateMatcher(TEMPLATES);
    const result = await matcher.match("帮我生成周报");

    expect(result.workflowId).toBe("weekly_report");
    expect(result.matchedBy).toBe("keyword");
    expect(mockCallAgnes).not.toHaveBeenCalled();
  });

  it("LLM confidence 低于阈值(0.6)时返回 null", async () => {
    mockCallAgnes.mockResolvedValue({
      content: JSON.stringify({
        workflowId: "weekly_report",
        confidence: 0.4,
        reason: "不太确定",
      }),
      model: "test",
    });

    const matcher = new TemplateMatcher(TEMPLATES);
    const result = await matcher.match("做个事情");

    expect(result.workflowId).toBeNull();
  });
});
