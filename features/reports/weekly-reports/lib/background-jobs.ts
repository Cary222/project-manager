/**
 * features/reports/weekly-reports/lib/background-jobs.ts
 *
 * PR4 实现：周报 AI 总结异步任务队列。
 * PR5 改造：内部从"直接 enqueueUpdateProfile" 改为"调 summarizeWeeklyReport"，
 *          后者会依次完成：写 partial → 调 LLM → 写 aiSummary → enqueueUpdateProfile。
 *
 * 复用 features/ai/lib/background-jobs.ts 的 15min 冷却窗机制。
 *
 * 业务语义：
 * - 周报提交/更新后触发 enqueueSummarizeWeeklyReport → 生成 AI 总结 → 刷新用户画像
 * - 函数名保留（PR4 已在 3 个路由里引用）
 *
 * 为什么 fire-and-forget：HTTP 响应不能等 LLM 完成，要立即返回。
 * 去重：enqueueUpdateProfile 内部 clearTimeout 同一 userId 的旧 timer，只保留最新一次。
 *
 * 错误处理：catch 所有异常并 console.warn，避免 Promise rejection 变成 unhandled。
 * HTTP 调用方已经收到 201，不会感知到后台任务失败——这是 fire-and-forget 的固有妥协。
 */

import { summarizeWeeklyReport } from "./summarize";

export async function enqueueSummarizeWeeklyReport(reportId: string): Promise<void> {
  setTimeout(() => {
    summarizeWeeklyReport(reportId).catch((err) => {
      console.warn(`[enqueueSummarizeWeeklyReport] failed for ${reportId}:`, err);
    });
  }, 500);
}
