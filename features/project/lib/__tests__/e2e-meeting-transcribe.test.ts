import { describe, it, expect } from "vitest";
import { prisma } from "@/shared/db/client";
import {
  generateMeetingSummaryFromTranscript,
  renderMeetingSummaryMarkdown,
  type MeetingSummaryData,
} from "@/features/ai/llm/meeting-summarizer";
import { transcribeWithDashScope } from "@/features/ai/llm/providers/audio/stt/dashscope";

describe("E2E Meeting Audio Transcribe & Summary Pipeline", () => {
  it("should transcribe real audio asset and generate 7-element summary successfully", async () => {
    // 1. 获取数据库中真实存在的音频
    const audioAsset = await prisma.fileAsset.findFirst({
      where: { mimeType: { contains: "audio" } },
    });

    if (!audioAsset) {
      console.warn(
        "[e2e-test] No audio file asset found in DB, skipping live ASR check",
      );
      return;
    }

    const user = await prisma.user.findFirst();
    const userId = user?.id || "";

    const audioBuffer = Buffer.from(audioAsset.bytes);

    // 2. 执行真实的语音转写
    const sttResult = await transcribeWithDashScope(audioBuffer, "mp3", {
      userId,
    });

    expect(sttResult.text).toBeTruthy();
    expect(sttResult.text.length).toBeGreaterThan(10);
    expect(sttResult.text).toContain("项目例会");

    // 3. 执行 AI 7 要素生成
    const summaryData: MeetingSummaryData =
      await generateMeetingSummaryFromTranscript({
        userId,
        meetingTitle: "2026年第35周 项目周例会",
        meetingDate: new Date(),
        transcript: sttResult.text,
        weeklyReports: [],
      });

    expect(summaryData.summary).toBeTruthy();
    expect(summaryData.progress.length).toBeGreaterThanOrEqual(1);
    expect(summaryData.actionItems.length).toBeGreaterThanOrEqual(1);
    expect(summaryData.nextPlans.length).toBeGreaterThanOrEqual(1);

    // 4. 验证正式 Markdown 渲染
    const markdown = renderMeetingSummaryMarkdown(
      "2026年第35周 项目周例会",
      new Date("2026-08-31"),
      summaryData,
    );

    expect(markdown).toContain("# 📑 2026年第35周 项目周例会");
    expect(markdown).toContain("## 📋 会议摘要");
    expect(markdown).toContain("## 📌 待办事项 (Action Items)");
  }, 60_000);
});
