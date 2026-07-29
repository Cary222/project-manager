/**
 * Formatter utilities for search-structured queries.
 * Reusable date/time formatting and text truncation helpers.
 */

import type { ActivityWindow } from "@/features/ai/types/structured";

/**
 * Map activityWindow enum to the inclusive lower bound of the time window.
 * Returns undefined to disable filtering.
 */
export function getWindowStart(
  window: ActivityWindow | undefined
): Date | undefined {
  if (!window) return undefined;
  const now = new Date();
  switch (window) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return new Date(y.getFullYear(), y.getMonth(), y.getDate());
    }
    case "this_week": {
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7; // 把周一当作一周开始
      d.setDate(d.getDate() - day);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    case "this_month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "recent":
      // "最近" 语义上等同于"本周"，按周一至今计算
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7; // 把周一当作一周开始
      d.setDate(d.getDate() - day);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
