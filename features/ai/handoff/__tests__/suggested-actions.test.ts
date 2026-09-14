import { describe, expect, it } from "vitest";
import { generateSuggestedActions } from "../suggested-actions";

describe("Suggested Actions Generator", () => {
  it("suggests weekly report when reviewing work/activity", () => {
    const actions = generateSuggestedActions({
      query: "这周我都完成了哪些工单？",
      queryType: "user",
    });

    const weeklyReport = actions.find(
      (a) => a.workflowHint === "weekly_report",
    );
    expect(weeklyReport).toBeDefined();
    expect(weeklyReport?.target).toBe("work");
    expect(weeklyReport?.label).toContain("周报");
  });

  it("suggests project progress when reviewing project status", () => {
    const actions = generateSuggestedActions({
      query: "当前项目进展和总体状态如何",
      queryType: "project",
    });

    const projectProgress = actions.find(
      (a) => a.workflowHint === "project_progress",
    );
    expect(projectProgress).toBeDefined();
    expect(projectProgress?.target).toBe("work");
  });

  it("suggests coding fix when discussing a specific bug or ticket", () => {
    const actions = generateSuggestedActions({
      query: "分析 #10208 报错崩溃的具体原因",
      resolvedEntities: {
        ticket: { id: "t-1", ticketNo: 10208, title: "崩溃排查" },
      },
    });

    const codingFix = actions.find((a) => a.capability === "coding.execute");
    expect(codingFix).toBeDefined();
    expect(codingFix?.target).toBe("work");
    expect(codingFix?.label).toContain("修复 #10208 代码");
    expect(codingFix?.payload?.ticketNo).toBe(10208);
  });

  it("suggests delay analysis when delays/blockers exist", () => {
    const actions = generateSuggestedActions({
      query: "查看已超期的工单",
      toolResults: {
        tickets: [{ status: "OVERDUE" }],
      },
    });

    const delayAction = actions.find((a) => a.target === "chat");
    expect(delayAction).toBeDefined();
    expect(delayAction?.label).toContain("分析延期阻碍原因");
  });

  it("suggests meeting minutes workflow when user asks to record meeting", () => {
    const actions = generateSuggestedActions({
      query: "我要记录会议纪要",
      queryType: "meeting",
      answerContent: "为你准备了会议纪要模板，请提供会议主题和参会人...",
    });
    const meetingAction = actions.find((a) => a.workflowHint === "meeting_minutes");
    expect(meetingAction).toBeDefined();
    expect(meetingAction?.target).toBe("work");
    expect(meetingAction?.label).toContain("会议纪要");
  });

  it("limits suggestions to at most 3 items", () => {
    const actions = generateSuggestedActions({
      query: "这周有延期的项目工单和bug崩溃问题需要处理",
      queryType: "project",
      resolvedEntities: {
        ticket: { id: "t-1", ticketNo: 10208 },
      },
      toolResults: { status: "OVERDUE" },
    });

    expect(actions.length).toBeLessThanOrEqual(3);
  });
});
