/**
 * search-structured Core — 核心业务逻辑
 *
 * 本模块只负责业务逻辑，返回 `{ summary, sources, candidates?, entityType? }`。
 * 不返回 `decision` 字段（HIL 信号）。
 *
 * HIL decision 由调用方添加：
 * - tools/search-structured.ts (工具模式) — 添加 HIL decision
 * - graph/nodes/search-structured.ts (LangGraph 模式) — 由 disambiguateIntentNode 处理
 */

import { z } from "zod";
import type { StructuredResult } from "@/features/ai/types/structured";
import { queryTicket } from "@/features/ai/core/queries/query-ticket";
import { queryUser } from "@/features/ai/core/queries/query-user";
import { queryProject } from "@/features/ai/core/queries/query-project";
import { queryCommit } from "@/features/ai/core/queries/query-commit";
import { queryWeeklyReport } from "@/features/ai/core/queries/query-weekly-report";
import { queryNote } from "@/features/ai/core/queries/query-note";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const searchStructuredInputSchema = z.object({
  type: z.enum(["ticket", "project", "user", "commit", "weekly_report", "note"]),
  id: z.string().optional().describe("工单号(如 #10156 或 10156)、项目ID、用户ID、commit SHA 等"),
  filters: z
    .object({
      status: z.string().optional().describe("ticket: DEVELOPING/READY_FOR_TEST/DONE/CLOSED 等"),
      priority: z.number().optional().describe("ticket: 1-4，数字越小优先级越高"),
      userId: z.string().optional().describe("用户标识（用户名、邮箱前缀、邮箱全称、cUID 等任意子串都会模糊匹配）"),
      projectId: z.string().optional().describe("项目ID"),
      title: z.string().optional().describe("note: 笔记标题模糊匹配"),
      ticketNo: z.number().int().optional().describe("commit: 按工单号过滤（关联 TicketCommit.ticketNo）"),
      activityWindow: z
        .enum(["today", "yesterday", "this_week", "this_month", "recent"])
        .optional()
        .describe("ticket/user/commit: 工作近况时间范围；today/昨日/本周/本月/最近"),
      extractedUser: z
        .object({
          raw: z.string().describe("原始输入"),
          normalized: z.string().describe("归一化输入"),
        })
        .optional()
        .describe("从用户消息提取的用户标识，包含原始值和归一化值"),
    })
    .optional(),
  limit: z.number().min(1).max(20).default(5),
});

export type SearchStructuredInput = z.infer<typeof searchStructuredInputSchema>;

// ---------------------------------------------------------------------------
// Core executor — no HIL decision, just business logic
// ---------------------------------------------------------------------------

/**
 * Execute a structured query with the given input.
 * Returns StructuredResult WITHOUT decision field (HIL signals are added by the caller).
 *
 * @param input - The query input
 * @param viewerUserId - The viewer's user ID (for permission checks)
 * @returns The structured result without HIL decision
 */
export async function executeStructuredQuery(
  input: SearchStructuredInput,
  viewerUserId?: string
): Promise<StructuredResult> {
  const { type, id, filters, limit: _limit } = input;

  console.log(`[searchStructuredCore] type=${type} id=${id} filters=${JSON.stringify(filters)} viewer=${viewerUserId}`);

  try {
    let result: StructuredResult;

    switch (type) {
      case "ticket":
        result = await queryTicket({ id, filters, viewerUserId });
        break;
      case "project":
        result = await queryProject({ id, filters });
        break;
      case "user":
        result = await queryUser({ id, filters }, viewerUserId);
        break;
      case "commit":
        result = await queryCommit({ id, filters }, viewerUserId);
        break;
      case "weekly_report":
        result = await queryWeeklyReport({ id, filters }, viewerUserId);
        break;
      case "note":
        result = await queryNote({ id, filters, limit: _limit }, viewerUserId);
        break;
      default:
        result = { summary: `不支持的查询类型: ${type}`, sources: [] };
    }

    console.log(`[searchStructuredCore] type=${type} result summary len=${result.summary.length} sources count=${result.sources.length}`);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[searchStructuredCore] error:", msg);
    return { summary: `查询失败: ${msg}`, sources: [] };
  }
}
