export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toUtcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toUtcEndOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

/** 返回给定日期所在自然周（周一 00:00 UTC → 周日 23:59:59 UTC）。 */
export function getWeekRange(reference: Date = new Date()): { weekStart: Date; weekEnd: Date } {
  const utc = toUtcStartOfDay(reference);
  const day = utc.getUTCDay();
  //周日(0)时: weekStart = 当天(不是-6天), weekEnd = 当天23:59:59
  //其他: weekStart = 本周一, weekEnd = 本周日23:59:59
  const offset = day === 0 ? 0 : 1 - day;
  const monday = new Date(utc.getTime() + offset * 24 * 60 * 60 * 1000);
  return {
    weekStart: toUtcStartOfDay(monday),
    weekEnd: toUtcEndOfDay(new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)),
  };
}

/** ISO 8601 周编号（周一是第一天，周 W01 包含1月4日）。 */
export function getIsoWeek(reference: Date): { year: number; week: number } {
  const { weekStart } = getWeekRange(reference);
  const jan4 = new Date(Date.UTC(weekStart.getUTCFullYear(), 0, 4, 0, 0, 0, 0));
  const jan4Day = jan4.getUTCDay() || 7;
  const thursday = new Date(jan4.getTime() + (4 - jan4Day) * 24 * 60 * 60 * 1000);
  const isoYear = thursday.getUTCFullYear();
  const daysSinceThursday = Math.floor((weekStart.getTime() - thursday.getTime()) / (24 * 60 * 60 * 1000));
  const isoWeek = Math.floor(daysSinceThursday / 7) + 1;
  return { year: isoYear, week: isoWeek };
}

/** 格式化周标签，如 "2026-W25 (6/23 - 6/29)"。 */
export function formatWeekLabel(weekStart: Date, weekEnd: Date): string {
  const { year, week } = getIsoWeek(weekStart);
  const startMonth = weekStart.getUTCMonth() + 1;
  const startDay = weekStart.getUTCDate();
  const endMonth = weekEnd.getUTCMonth() + 1;
  const endDay = weekEnd.getUTCDate();
  return `${year}-W${String(week).padStart(2, "0")} (${startMonth}/${startDay} - ${endMonth}/${endDay})`;
}

/** 校验 weekEnd - weekStart 在 [WEEK_MS, WEEK_MS + 一天] 之间。 */
export function isValidWeekRange(weekStart: Date, weekEnd: Date): boolean {
  const diff = weekEnd.getTime() - weekStart.getTime();
  return diff >= WEEK_MS && diff <= WEEK_MS + 86_400_000;
}

// 手测
