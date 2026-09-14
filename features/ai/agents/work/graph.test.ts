import { describe, it, expect, vi, beforeEach } from "vitest";
import { getWorkAgentGraph, initializeWorkAgent } from "./graph";

// Mock callAgnes
vi.mock("@/features/ai/llm/summarizer", () => ({
  callAgnes: vi.fn(),
}));

import { callAgnes } from "@/features/ai/llm/summarizer";
const mockCallAgnes = vi.mocked(callAgnes);

describe("Work Agent 图执行效果展示 (Graph E2E)", () => {
  beforeEach(() => {
    mockCallAgnes.mockReset();
    initializeWorkAgent();
  });

  it("效果 1: [关键词快路径] 输入包含明确关键词 → 瞬间命中周报工作流", async () => {
    const graph = getWorkAgentGraph();
    const input = "帮我生成周报";

    const state = await graph.invoke({
      runId: "test-keyword",
      userId: "user-1",
      userName: "Alice",
      sessionId: "s-1",
      userInput: input,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    process.stdout.write(`
┌─────────────────────────────────────────────────────────────┐
│ 【用例效果 1】关键词快路径匹配                                │
│ 输入: "${input}"                                            │
│ 命中方式: 关键词匹配 (0ms，无需 LLM)                         │
│ 路由结果: taskType = "${state.taskType}"                     │
│ 工作流ID: workflowType = "${state.workflowType}"             │
│ 工作流名: workflowName = "${state.workflowName}"             │
└─────────────────────────────────────────────────────────────┘`);

    expect(state.taskType).toBe("workflow");
    expect(state.workflowType).toBe("weekly_report");
    expect(mockCallAgnes).not.toHaveBeenCalled();
  });

  it("效果 2: [LLM 语义路由] 输入无周报字样 → LLM 意图识别准确分诊至周报", async () => {
    // 模拟 LLM 语义分类返回
    mockCallAgnes.mockResolvedValueOnce({
      content: JSON.stringify({
        workflowId: "weekly_report",
        confidence: 0.88,
        reason: "用户希望汇总本周进度并整理汇报材料，属于周报范畴",
      }),
      model: "agnes-2.0-flash",
    });

    const graph = getWorkAgentGraph();
    const input = "把这周各个项目的推进情况梳理一份发给领导审阅";

    const state = await graph.invoke({
      runId: "test-llm-route",
      userId: "user-1",
      userName: "Alice",
      sessionId: "s-2",
      userInput: input,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    process.stdout.write(`
┌─────────────────────────────────────────────────────────────┐
│ 【用例效果 2】LLM 语义路由 (无“周报”死板关键词)              │
│ 输入: "${input}"                                            │
│ 识别方式: LLM 意图推理 (matchByLLM)                          │
│ 路由结果: taskType = "${state.taskType}"                     │
│ 工作流ID: workflowType = "${state.workflowType}"             │
│ 工作流名: workflowName = "${state.workflowName}"             │
└─────────────────────────────────────────────────────────────┘`);

    expect(state.taskType).toBe("workflow");
    expect(state.workflowType).toBe("weekly_report");
    expect(mockCallAgnes).toHaveBeenCalledTimes(1);
  });

  it("效果 3: [LLM 自主规划与 HIL] 复杂定制任务 → LLM 拆解多步并挂起审批", async () => {
    // 1. 模拟 matcher 未命中任何已有模板
    mockCallAgnes.mockResolvedValueOnce({
      content: JSON.stringify({
        workflowId: null,
        confidence: 0.1,
        reason: "不属于已有模板",
      }),
      model: "agnes-2.0-flash",
    });

    // 2. 模拟 LLPlanner 拆解出 3 个相互依赖的步骤
    mockCallAgnes.mockResolvedValueOnce({
      content: JSON.stringify({
        steps: [
          {
            id: "step-1",
            action: "查询延期工单",
            description: "筛选近一个月状态为已超期的所有高优先级工单",
            tool: "business_query",
            args: { entity: "ticket" },
            dependsOn: [],
          },
          {
            id: "step-2",
            action: "归因聚类分析",
            description: "分析导致延期的阻碍原因并计算各模块占比",
            tool: "generate_text",
            args: { instruction: "分析" },
            dependsOn: ["step-1"],
          },
          {
            id: "step-3",
            action: "生成复盘报告",
            description: "综合前置分析产出格式化的复盘整改报告",
            tool: "generate_text",
            args: { instruction: "分析" },
            dependsOn: ["step-2"],
          },
        ],
      }),
      model: "agnes-2.0-flash",
    });

    const graph = getWorkAgentGraph();
    const input = "统计近期延期工单的核心原因并产出改进复盘报告";

    const state = await graph.invoke({
      runId: "test-planning-hil",
      userId: "user-1",
      userName: "Alice",
      sessionId: "s-3",
      userInput: input,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const stepsOutput = state.steps
      .map(
        (s, idx) =>
          `│   步骤 ${idx + 1}: [${s.action}] -> 工具: ${s.tool || "无"} (依赖: ${s.dependsOn.join(",") || "无"})\n│          详情: ${s.description}`,
      )
      .join("\n");

    process.stdout.write(`
┌─────────────────────────────────────────────────────────────┐
│ 【用例效果 3】LLM 自主任务规划 + HIL 人机协同审批            │
│ 输入: "${input}"                                            │
│ 路由结果: taskType = "${state.taskType}"                     │
│ 状态转移: status = "${state.status}" (waitingForHuman: ${state.waitingForHuman}) │
│ 生成步骤 (共 ${state.steps.length} 步):                                        │
${stepsOutput}
│                                                             │
│ 人机协同审批卡片 (HIL Payload):                              │
│ 标题: ${state.pendingApproval?.title}                       │
│ 内容预览:                                                   │
${state.pendingApproval?.description
  .split("\n")
  .map((line) => `│   ${line}`)
  .join("\n")}
└─────────────────────────────────────────────────────────────┘`);

    expect(state.taskType).toBe("planning");
    expect(state.status).toBe("waiting_approval");
    expect(state.waitingForHuman).toBe(true);
    expect(state.steps.length).toBe(3);
    expect(state.pendingApproval?.title).toContain("待确认");
    expect(state.pendingApproval?.description).toContain("查询延期工单");
  });

  it("效果 4: [Coding 快路径保护] 包含代码/修复动作 → 优先分派至 Pi Coding", async () => {
    const graph = getWorkAgentGraph();
    const input = "修复工单评论组件在网络超时下的页面报错";

    const state = await graph.invoke({
      runId: "test-coding-guard",
      userId: "user-1",
      userName: "Alice",
      sessionId: "s-4",
      userInput: input,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    process.stdout.write(`
┌─────────────────────────────────────────────────────────────┐
│ 【用例效果 4】Coding 任务专有快路径分流                     │
│ 输入: "${input}"                                            │
│ 路由结果: taskType = "${state.taskType}"                     │
│ 执行状态: status = "${state.status}"                         │
│ 提示摘要: ${state.summary}    │
└─────────────────────────────────────────────────────────────┘`);

    expect(state.taskType).toBe("coding");
    expect(state.status).toBe("pi_pending");
    expect(mockCallAgnes).not.toHaveBeenCalled();
  });
});
