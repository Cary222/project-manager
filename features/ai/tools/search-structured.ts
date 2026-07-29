/**
 * searchStructured Tool — Vercel AI SDK tool adapter
 *
 * 职责：包装 core + 添加 HIL decision
 * - 复用 search-structured-core.ts 的核心业务逻辑
 * - 在返回结果时添加 `decision` 字段（HIL 信号）
 * - 符合 Vercel AI SDK 的 tool() 接口规范
 */

import { tool } from "ai";
import { z } from "zod";
import { searchStructuredInputSchema, executeStructuredQuery } from "@/features/ai/core/search-structured-core";

// ---------------------------------------------------------------------------
// Viewer context injection
// ---------------------------------------------------------------------------

/**
 * searchStructured uses a module-scoped viewerUserId that's injected per-request
 * via `setSearchStructuredViewer()`. This is because Agnes does NOT support
 * `contextSchema` (Vercel AI SDK extension), so we cannot pass runtime context
 * through toolsContext.
 */
let currentViewerUserId: string | null = null;
export function setSearchStructuredViewer(userId: string | null) {
  currentViewerUserId = userId;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const searchStructured = tool({
  description:
    `【精确查询 - 快速浅查工具】
定位：分层查询的第一步（浅查），用于快速获取基础信息

适用场景：
- 精确 ID 查询：工单号（#10156）、项目 ID、用户 ID、commit SHA
- 进度统计：完成率、逾期数、进行中统计
- 列表查询：所有活跃项目、用户工单列表、周报列表
- 过滤查询：按 status/priority/userId/projectId 过滤

支持的查询类型（必须指定 type）：
- type=ticket：工单查询，支持 id（工单号或 ID）和 filters 过滤
- type=project：项目查询，支持 id（项目 ID），无 id 时列出所有活跃项目
- type=user：用户查询，支持 id 或 filters.userId（支持中文姓名模糊匹配）
- type=commit：提交查询，支持 id（commit SHA 前缀）
- type=weekly_report：周报查询，支持 id 或 filters.userId

【不擅长 - 请用 searchKnowledge】：
- 语义模糊的查询（"关于 X 的讨论"、"最近相关的笔记"）→ 用 searchKnowledge
- 需要理解文档内容的综合搜索 → 用 searchKnowledge
- 需要附件内容、讨论上下文 → 用 searchKnowledge`,
  inputSchema: searchStructuredInputSchema,
  execute: async ({ type, id, filters, limit: _limit }) => {
    const viewerUserId = currentViewerUserId ?? undefined;
    console.log(`[searchStructured] type=${type} id=${id} filters=${JSON.stringify(filters)} viewer=${viewerUserId}`);

    const result = await executeStructuredQuery({ type, id, filters, limit: _limit }, viewerUserId);

    // Return full result with HIL decision (if any) — the caller handles it
    return {
      summary: result.summary,
      sources: result.sources,
      ...(result.attribution ? { attribution: result.attribution } : {}),
      // decision is preserved from core (from query functions that return it)
      ...(result.decision ? { decision: result.decision } : {}),
      // Echo the query type so the graph can carry it through pendingHumanAction
      queryType: type,
      _debug: "structured_with_sources"
    };
  },
});
