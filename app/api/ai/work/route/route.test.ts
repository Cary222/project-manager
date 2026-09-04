import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/shared/lib/permissions", () => ({
  requireSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "test-user-1", name: "Cary" } }),
}));

vi.mock("@/features/ai/llm/summarizer", () => ({
  callAgnes: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      confidence: "60%",
      steps: [
        {
          key: "plan",
          prompt:
            "针对需求「帮我做一份 ticket 模块重构计划方案」进行系统架构设计与任务拆解。梳理核心模块依赖、接口规范与风险边界，生成分步实施方案，暂不修改代码。",
        },
        {
          key: "goal",
          prompt:
            "针对需求「帮我做一份 ticket 模块重构计划方案」进行功能迭代与代码实现。编写核心业务逻辑，处理异常边界，并补齐单元测试直至交付完成。",
        },
        {
          key: "review",
          prompt:
            "对「帮我做一份 ticket 模块重构计划方案」的代码改动进行全面审查，重点核验是否存在过度设计、死代码、潜在安全漏洞与规范违规。",
        },
      ],
    }),
  }),
}));

describe("POST /api/ai/work/route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preflights goal prompt and returns structured workflow route and steps", async () => {
    const req = new NextRequest("http://localhost:3003/api/ai/work/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "帮我做一份 ticket 模块重构计划方案",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.title).toContain("Pi Route");
    expect(json.data.bestRouteText).toContain("方案规划");
    expect(json.data.steps).toHaveLength(3);
    expect(json.data.steps[0].command).toBe("/plannotator-plan-mode");
    expect(json.data.rawText).toContain("最佳方案路线");
    expect(json.data.rawText).toContain("推荐置信度: 60%");
  });

  it("regenerates steps when user changes selected commands", async () => {
    const req = new NextRequest("http://localhost:3003/api/ai/work/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: "搜索最新 Next.js 规则并审查代码",
        selectedCommands: ["websearch", "review"],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.bestRouteSteps).toEqual(["资料检索", "合规与质量审计"]);
    expect(json.data.steps).toHaveLength(2);
    expect(json.data.steps[0].command).toBe("/websearch");
    expect(json.data.steps[1].command).toBe("/plannotator-review");
  });
});
