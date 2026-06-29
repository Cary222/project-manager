/**
 * features/reports/weekly-reports/lib/summarize.ts
 *
 * PR5 实现：周报 AI 总结生成。
 * 调用 callAgnes 生成周报的 AI 摘要，写入 WeeklyReport.aiSummary。
 * 无论成功/失败，最终触发 enqueueUpdateProfile 刷新用户画像。
 */

import { prisma } from "@/shared/db/client";
import { callAgnes } from "@/features/ai/lib/summarizer";
import { enqueueUpdateProfile } from "@/features/ai/lib/background-jobs";

const MAX_CONTENT_LENGTH = 8000;

const SUMMARY_INSTRUCTION = [
  "你是一个项目助理。用户提交了本周的工作周报，请用简洁的语言总结：",
  "",
  "要求：",
  "1. 本周完成了哪些工作",
  "2. 涉及哪些项目或模块",
  "3. 下周计划（如有）",
  "",
  "用 Markdown 格式输出，2-3 段即可，不要超过 200 字。",
].join("\n");

function buildSummaryPrompt(title: string, content: string): string {
  return [
    SUMMARY_INSTRUCTION,
    "",
    "周报内容：",
    "---",
    title,
    "",
    content,
    "---",
  ].join("\n");
}

async function callAgnesForSummary(
  title: string,
  content: string
): Promise<string> {
  const prompt = buildSummaryPrompt(title, content);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SUMMARY_INSTRUCTION },
    { role: "user", content: prompt },
  ];
  return callAgnes(messages);
}

/**
 * 生成周报 AI 总结并写入 DB。
 *
 * 流程：
 * 1. 查 WeeklyReport，不存在 → no-op
 * 2. content 为空字符串 → 不调 LLM，直接 return
 * 3. 先写 partial 状态（aiSummaryPartial: true）→ UI 显示"生成中"
 * 4. 调 callAgnes 生成 aiSummary
 * 5. 写 aiSummary + aiSummaryPartial: false + aiSummaryAt
 * 6. 无论成功/失败 → enqueueUpdateProfile 刷新画像
 * 7. 失败时写 fallback（空字符串）+ aiSummaryPartial: false（避免 partial=true 卡住 UI）
 */
export async function summarizeWeeklyReport(reportId: string): Promise<void> {
  try {
    const report = await prisma.weeklyReport.findUnique({
      where: { id: reportId },
      select: { id: true, userId: true, title: true, content: true },
    });
    if (!report) return;

    if (!report.content || report.content.trim() === "") {
      // content 为空，不调 LLM，直接触发画像刷新
      enqueueUpdateProfile(report.userId);
      return;
    }

    // Step 1: 写 partial 状态 → UI 显示"生成中"
    await prisma.weeklyReport.update({
      where: { id: reportId },
      data: { aiSummaryPartial: true },
    });

    // Step 2: 调 LLM
    const truncatedContent =
      report.content.length > MAX_CONTENT_LENGTH
        ? report.content.slice(0, MAX_CONTENT_LENGTH) + "…（内容已截断）"
        : report.content;

    let aiSummary: string;
    try {
      aiSummary = await callAgnesForSummary(report.title, truncatedContent);
    } catch (err) {
      console.warn(`[summarizeWeeklyReport] LLM call failed for ${reportId}:`, err);
      // LLM 失败，写 fallback 并确保 partial=false，避免永远卡住
      await prisma.weeklyReport.update({
        where: { id: reportId },
        data: { aiSummary: "", aiSummaryPartial: false },
      });
      enqueueUpdateProfile(report.userId);
      return;
    }

    // Step 3: 写 aiSummary
    await prisma.weeklyReport.update({
      where: { id: reportId },
      data: {
        aiSummary: aiSummary.trim(),
        aiSummaryAt: new Date(),
        aiSummaryPartial: false,
      },
    });

    // Step 4: 触发画像刷新（无论成功失败都走这一步）
    enqueueUpdateProfile(report.userId);
  } catch (err) {
    console.warn(`[summarizeWeeklyReport] failed for ${reportId}:`, err);
    // 吞错：HTTP 响应早已发出，防止 unhandled rejection
    // 如果 report 存在，尝试写 fallback 避免 partial 卡住
    try {
      await prisma.weeklyReport.update({
        where: { id: reportId },
        data: { aiSummaryPartial: false },
      }).catch(() => {/* ignore if already deleted */});
    } catch {
      // ignore
    }
  }
}
