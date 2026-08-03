/**
 * Formatter utilities for search-structured queries.
 * Reusable date/time formatting and text truncation helpers.
 */

import type { ActivityWindow } from "@/features/ai/types/structured";

/**
 * Map activityWindow enum to the inclusive lower bound of the time window.
 * Returns undefined to disable filtering.
 * 
 * IMPORTANT: Returns UTC Date to match database updatedAt column timezone.
 * Uses Date.UTC() to avoid local timezone offset issues.
 */
export function getWindowStart(
  window: ActivityWindow | undefined
): Date | undefined {
  if (!window) return undefined;
  const now = new Date();
  
  switch (window) {
    case "today": {
      const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return utc;
    }
    case "yesterday": {
      const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      utc.setUTCDate(utc.getUTCDate() - 1);
      return utc;
    }
    case "this_week": {
      const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const day = (utc.getUTCDay() + 6) % 7; // 把周一当作一周开始
      utc.setUTCDate(utc.getUTCDate() - day);
      return utc;
    }
    case "this_month": {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }
    case "recent": {
      // "最近" 语义：最近 7 天（包括今天），避免周一早上查不到昨天工单的问题
      const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      utc.setUTCDate(utc.getUTCDate() - 6); // 往前推 6 天 + 今天 = 7 天
      return utc;
    }
    default:
      return undefined;
  }
}

export function formatWindowLabel(window: ActivityWindow | undefined): string | null {
  if (!window) return null;
  const labels: Record<ActivityWindow, string> = {
    today: "今天",
    yesterday: "昨天",
    this_week: "本周",
    this_month: "本月",
    recent: "最近",
  };
  return labels[window] ?? null;
}

export function formatReportDate(value: Date | string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

export function formatReportPeriod(start: Date | string, end: Date | string): string {
  return `${formatReportDate(start)} - ${formatReportDate(end)}`;
}

/**
 * 截断字符串到 maxLen 字符以内,优先在句末标点处截断,避免截到一半中文词。
 * 用于周报 aiSummary 摘要内嵌,避免单条周报内容把 summary 撑爆。
 */
export function truncateForSummary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // 优先尝试在 maxLen 之前的最近句末标点处截断
  const slice = text.slice(0, maxLen);
  const lastPunct = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("?"),
    slice.lastIndexOf("\n")
  );
  if (lastPunct > maxLen * 0.5) {
    return slice.slice(0, lastPunct + 1) + "…";
  }
  return slice.replace(/\s+\S*$/, "") + "…";
}
