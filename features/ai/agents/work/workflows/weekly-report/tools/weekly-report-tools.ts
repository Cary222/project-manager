/**
 * Weekly Report Tools — Workflow Node 适配层
 *
 * 封装 features/reports/weekly-reports/lib/ 的函数，
 * 供 workflow nodes 调用。
 */

import { aggregateWeeklyContext, type WeeklyContext } from "@/features/reports/weekly-reports/lib/context-aggregator";
import {
  generateWeeklyDraftSummary,
  reviseWeeklyDraftSummary,
  type WeeklyDraftSummary,
} from "@/features/reports/weekly-reports/lib/draft-summary";

// ============================================================================
// Collect Data
// ============================================================================

export interface CollectWeeklyDataResult {
  tickets: WeeklyContext["tickets"];
  notes: WeeklyContext["notes"];
  conversations: WeeklyContext["conversations"];
  visits: WeeklyContext["visits"];
}

/**
 * Collect all data for a given user and time range.
 */
export async function collectWeeklyData(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<WeeklyContext> {
  return aggregateWeeklyContext(userId, weekStart, weekEnd);
}

// ============================================================================
// Draft Generation
// ============================================================================

/**
 * Generate a weekly draft from collected context.
 */
export async function draftWeeklyReport(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
  context: WeeklyContext
): Promise<WeeklyDraftSummary> {
  return generateWeeklyDraftSummary(userId, weekStart, weekEnd, undefined, context);
}

/**
 * Revise a draft based on user feedback.
 * Passes the original context so AI can reference raw data when revising.
 */
export async function reviseWeeklyDraft(
  userId: string,
  draft: WeeklyDraftSummary,
  feedback: string,
  context: WeeklyContext
): Promise<WeeklyDraftSummary> {
  return reviseWeeklyDraftSummary(userId, draft, feedback, context);
}
