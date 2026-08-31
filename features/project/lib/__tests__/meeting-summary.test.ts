import { describe, it, expect } from "vitest";
import {
  parseAndValidateSummaryJson,
  renderMeetingSummaryMarkdown,
  type MeetingSummaryData,
} from "@/features/ai/llm/meeting-summarizer";
import { inferFormatFromMimeType } from "@/features/ai/llm/providers/audio/stt/dashscope";

describe("Meeting Summary Processing", () => {
  it("should infer audio format correctly from mimeType and filename", () => {
    expect(inferFormatFromMimeType("audio/mpeg", "weekly-meeting.mp3")).toBe(
      "mp3",
    );
    expect(inferFormatFromMimeType("audio/x-m4a", "record.m4a")).toBe("m4a");
    expect(inferFormatFromMimeType("audio/wav", "voice.wav")).toBe("wav");
    expect(inferFormatFromMimeType("audio/webm", "test.webm")).toBe("webm");
    expect(inferFormatFromMimeType("audio/mp4", "test.mp4")).toBe("mp4");
  });

  it("should parse and validate standard 7-element JSON response", () => {
    const rawJson = JSON.stringify({
      summary: "本次项目周会重点讨论了后台任务稳定性改造与周会纪要自动化方案。",
      progress: ["完成订单模块重构", "修复了已知 3 个并发 Bug"],
      discussions: ["关于异步任务超时的重试策略探讨", "长音频 ASR 方案选型"],
      decisions: [
        "统一采用 Token Plan MaaS 异步转写",
        "周会草稿支持多版本隔离",
      ],
      actionItems: [
        { task: "实现前端审核工作台", assignee: "张三", dueDate: "2026-08-30" },
        { task: "配置 Worker systemd 守护", assignee: "李四" },
      ],
      risks: ["第三方 ASR 通道在大并发下可能限流"],
      nextPlans: ["完成全链路端到端验收并发布上线"],
    });

    const result = parseAndValidateSummaryJson(rawJson);

    expect(result.summary).toContain("本次项目周会重点讨论");
    expect(result.progress).toHaveLength(2);
    expect(result.discussions).toHaveLength(2);
    expect(result.decisions).toHaveLength(2);
    expect(result.actionItems).toHaveLength(2);
    expect(result.actionItems[0]).toEqual({
      task: "实现前端审核工作台",
      assignee: "张三",
      dueDate: "2026-08-30",
    });
    expect(result.risks).toHaveLength(1);
    expect(result.nextPlans).toHaveLength(1);
  });

  it("should parse markdown-wrapped json codeblocks correctly", () => {
    const wrapped = `\`\`\`json
{
  "summary": "会议总结内容",
  "progress": ["进展1"],
  "discussions": ["讨论1"],
  "decisions": ["决策1"],
  "actionItems": [{ "task": "待办1", "assignee": "王五" }],
  "risks": ["风险1"],
  "nextPlans": ["计划1"]
}
\`\`\``;

    const result = parseAndValidateSummaryJson(wrapped);
    expect(result.summary).toBe("会议总结内容");
    expect(result.actionItems[0].task).toBe("待办1");
    expect(result.actionItems[0].assignee).toBe("王五");
  });

  it("should fallback gracefully on invalid json", () => {
    const broken = "这是一段无法解析为 JSON 的纯文本输出，但包含会议信息。";
    const result = parseAndValidateSummaryJson(broken, "原始转录备份");

    expect(result.summary).toBeTruthy();
    expect(result.discussions).toHaveLength(1);
    expect(Array.isArray(result.actionItems)).toBe(true);
  });

  it("should render clean and structured Markdown document for publishing", () => {
    const summaryData: MeetingSummaryData = {
      summary: "2026年第35周例会纪要核心内容。",
      progress: ["完成核心 API 路由开发", "通过单元测试"],
      discussions: ["讨论了 RAG 向量切片参数"],
      decisions: ["确定周会纪要以 Markdown 形式归档到正式 Document"],
      actionItems: [
        { task: "上线周会功能", assignee: "项目专员", dueDate: "2026-09-01" },
      ],
      risks: ["无明显风险"],
      nextPlans: ["推进下一阶段功能开发"],
    };

    const markdown = renderMeetingSummaryMarkdown(
      "2026-W35 项目周例会",
      new Date("2026-08-28T10:00:00Z"),
      summaryData,
    );

    expect(markdown).toContain("# 📑 2026-W35 项目周例会");
    expect(markdown).toContain("> **会议日期**：2026-08-28");
    expect(markdown).toContain("## 📋 会议摘要");
    expect(markdown).toContain("## 🚀 本周进展");
    expect(markdown).toContain("- 完成核心 API 路由开发");
    expect(markdown).toContain("## 💬 讨论事项");
    expect(markdown).toContain("## ⚖️ 决策事项");
    expect(markdown).toContain("## 📌 待办事项 (Action Items)");
    expect(markdown).toContain(
      "- [ ] **上线周会功能** @项目专员 (截止: 2026-09-01)",
    );
    expect(markdown).toContain("## ⚠️ 风险预警");
    expect(markdown).toContain("## 🎯 下周计划");
  });
});
