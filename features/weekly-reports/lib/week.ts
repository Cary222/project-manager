export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 项目统一使用北京时间（UTC+8）作为周范围基准。 */
const SHANGHAI = "en-CA"; // 使用 en-CA 拿到 YYYY-MM-DD 格式，规避各 OS locale 默认值差异

function getBeijingDateParts(reference: Date): { year: number; month: number; day: number; weekday: number } {
  // 取北京日历下的年/月/日/星期几。en-CA 总是输出 YYYY-MM-DD，避免不同 locale 顺序问题。
  const dateStr = new Intl.DateTimeFormat(SHANGHAI, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(reference);

  const lookup = Object.fromEntries(dateStr.map((p) => [p.type, p.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);

  // weekday 短码 → 数字（Sun=0, Mon=1, ... Sat=6）
  const WEEKDAY_MAP: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = WEEKDAY_MAP[lookup.weekday] ?? reference.getUTCDay();

  return { year, month, day, weekday };
}

function beijingMidnightToUtc(year: number, month: number, day: number, hour = 0): Date {
  // 北京时间 YYYY-MM-DD HH:mm:ss 对应的 UTC Date（UTC+8 → UTC = 减去 8h）
  return new Date(Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0));
}

/** 将 UTC Date 格式化为北京时间日历日期，供 `<input type="date">` 使用。 */
export function formatBeijingDateInput(date: Date): string {
  const parts = new Intl.DateTimeFormat(SHANGHAI, {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** 返回给定日期所在自然周（周一 00:00 北京 → 周日 23:59:59 北京）。 */
export function getWeekRange(reference: Date = new Date()): { weekStart: Date; weekEnd: Date } {
  const { year, month, day, weekday } = getBeijingDateParts(reference);
  // 周日(0)时: weekStart = 当天(不是-6天)
  // 其他: weekStart = 本周一
  const offset = weekday === 0 ? 0 : 1 - weekday;
  // 用 Date 算偏移（自动跨月/跨年），然后取北京日历日
  const mondayLocal = new Date(year, month - 1, day + offset);
  const sundayLocal = new Date(year, month - 1, day + offset + 6);

  return {
    weekStart: beijingMidnightToUtc(mondayLocal.getFullYear(), mondayLocal.getMonth() + 1, mondayLocal.getDate()),
    weekEnd: new Date(beijingMidnightToUtc(sundayLocal.getFullYear(), sundayLocal.getMonth() + 1, sundayLocal.getDate(), 23).getTime() + 999),
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

/**
 * 根据相对周偏移量返回对应周范围。
 * offset = 0 → 本周；offset = 1 → 上周；offset = N → N 周前。
 * 允许任意整数（正数表示过去周，0 表示本周，负数表示未来周）。
 */
export function getWeekRangeByOffset(offset: number, now: Date = new Date()): { weekStart: Date; weekEnd: Date; offset: number } {
  const shifted = new Date(now.getTime() - offset * WEEK_MS);
  const { weekStart, weekEnd } = getWeekRange(shifted);
  return { weekStart, weekEnd, offset };
}

/**
 * 根据周开始日期返回友好的中文标题。
 * - 本周 → 本周周报
 * - 上周 → 上周周报
 * - 更早的周 → 第 N 周周报（N = ISO 周编号）
 */
export function getWeekReportTitle(weekStart: Date, now: Date = new Date()): string {
  const currentRange = getWeekRange(now);
  if (weekStart.getTime() === currentRange.weekStart.getTime()) return "本周周报";

  const lastRange = getWeekRange(new Date(now.getTime() - WEEK_MS));
  if (weekStart.getTime() === lastRange.weekStart.getTime()) return "上周周报";

  const { week } = getIsoWeek(weekStart);
  return `第${week}周周报`;
}

// 手测
