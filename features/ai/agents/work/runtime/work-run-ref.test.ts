import { describe, expect, it } from "vitest";
import { routeWorkGoal } from "./work-run-ref";

describe("routeWorkGoal", () => {
  it.each([
    ["汇总本周项目进展", "project_progress"],
    ["我上周干了什么", "project_progress"],
    ["我上周做了什么", "project_progress"],
    ["最近团队在做什么", "project_progress"],
    ["生成本周周报", "weekly_report"],
    ["整理会议纪要", "meeting_minutes"],
    ["修复 #10212 的代码", "coding"],
    ["帮我看看我下载了哪些插件", "coding"],
    ["分析项目架构与组件依赖", "coding"],
  ] as const)("routes %s to %s", (goal, expected) => {
    expect(routeWorkGoal(goal)).toBe(expected);
  });
});
