/**
 * backfill-weekly-report-rate.ts
 *
 * 基于 weeklyReport.createdAt 重新计算历史每日周报提交情况。
 * 逻辑：遍历所有周报记录，按 createdAt 归属到对应日历日，累积计算每日提交率。
 *
 * 用法：
 *   npx tsx scripts/backfill-weekly-report-rate.ts
 *
 * 输出：
 *   - 控制台打印每天的汇总
 *   - 将结果写入 scripts/.weekly-report-rate-backfill.json（便于前端/报表直接读取）
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

// ─────────────────────────────────────────────
// 辅助：北京时间转 UTC Date（用于查询区间）
// ─────────────────────────────────────────────
function toUtcStartOfDay(year: number, month: number, day: number): Date {
  // 北京时间当天 00:00:00 → UTC = 当天 00:00:00 - 8h
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
function toUtcEndOfDay(year: number, month: number, day: number): Date {
  // 北京时间当天 23:59:59.999 → UTC = 当天 23:59:59.999 - 8h
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

// ─────────────────────────────────────────────
// 辅助：UTC Date → 北京时间年月日
// ─────────────────────────────────────────────
function toBeijingYmd(utc: Date): { year: number; month: number; day: number } {
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(utc);
  const lookup = Object.fromEntries(dateStr.map((p) => [p.type, p.value]));
  return {
    year:  Number(lookup.year),
    month: Number(lookup.month),
    day:   Number(lookup.day),
  };
}

// ─────────────────────────────────────────────
// 辅助：判断某年某月某日是否属于"日历周"(周一~周日)
// ─────────────────────────────────────────────
function getBeijingWeekBounds(year: number, month: number, day: number): { weekStart: Date; weekEnd: Date } {
  // 用 Intl算出北京日历下该日是周几（Mon=1 ... Sun=7）
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(`${dateStr}T00:00:00`));
  const weekdayVal = weekday.find((p) => p.type === "weekday")?.value ?? "Mon";
  const WEEKDAY_MAP: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const w = WEEKDAY_MAP[weekdayVal] ?? 1;

  // 计算该日历周周一
  const mondayDay = day - (w - 1);
  const monday = new Date(Date.UTC(year, month - 1, mondayDay, 0, 0, 0, 0));
  const sunday = new Date(Date.UTC(year, month - 1, mondayDay + 6, 23, 59, 59, 999));

  return {
    weekStart: toUtcStartOfDay(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    weekEnd:   toUtcEndOfDay(sunday.getUTCFullYear(),   sunday.getUTCMonth()   + 1, sunday.getUTCDate()),
  };
}

// ─────────────────────────────────────────────
// 主逻辑：遍历所有周报，累积计算每天提交率
// ─────────────────────────────────────────────
interface DayReportRate {
  date: string;        // "2026-07-03"
  weekLabel: string;  // "2026-W27"
  weekday: string;    // "周五"
  weekStart: string;  // 北京时间周一
  weekEnd: string;    // 北京时间周日
  totalUsers: number;
  submitted: number;
  rate: number;        // 百分比 0~100
}

async function backfillDailyReportRates(): Promise<DayReportRate[]> {
  // 1. 查所有用户（未封禁）
  const allUsers = await prisma.user.findMany({
    where: { bannedAt: null },
    select: { id: true },
  });
  const totalUsers = allUsers.length;
  const userIds = new Set(allUsers.map((u) => u.id));

  console.log(`总用户数（未封禁）: ${totalUsers}`);

  // 2. 查所有周报，按 createdAt 升序（这样累积计数是对的）
  const allReports = await prisma.weeklyReport.findMany({
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`总周报记录数: ${allReports.length}`);
  if (allReports.length === 0) {
    console.log("无周报数据，无需 backfill。");
    return [];
  }

  // 3. 确定日期范围：从最早一条到今天（含今天）
  const firstReport = allReports[0];
  const now = new Date();
  const { year: curYear, month: curMonth, day: curDay } = toBeijingYmd(now);

  const { year: firstYear, month: firstMonth, day: firstDay } = toBeijingYmd(firstReport.createdAt);

  // 4. 逐日遍历，累积计算
  const results: DayReportRate[] = [];
  const submittedInWeek = new Set<string>(); // 当前日历周内已提交的用户

  // 当前日历周信息（用于 weekLabel）
  let currentWeekYear = 0;
  let currentWeekNum = 0;
  let currentWeekStart: Date | null = null;
  let currentWeekEnd: Date | null = null;

  // 外层：年份
  for (let year = firstYear; year <= curYear; year++) {
    const startMonth = year === firstYear ? firstMonth : 1;
    const endMonth   = year === curYear     ? curMonth  : 12;

    // 内层：月份
    for (let month = startMonth; month <= endMonth; month++) {
      const startDay = (year === firstYear && month === firstMonth) ? firstDay : 1;
      const endDay = (year === curYear && month === curMonth) ? curDay : getLastDayOfMonth(year, month);

      // 内层：日
      for (let day = startDay; day <= endDay; day++) {
        const dayStart = toUtcStartOfDay(year, month, day);
        const dayEnd   = toUtcEndOfDay(year, month, day);

        // 检查是否进入新日历周
        const { weekStart, weekEnd } = getBeijingWeekBounds(year, month, day);
        if (currentWeekStart === null || weekStart.getTime() !== currentWeekStart.getTime()) {
          // 新日历周开始，重置该周提交记录
          currentWeekStart = weekStart;
          currentWeekEnd   = weekEnd;
          submittedInWeek.clear();

          // 计算 ISO 周编号
          const { year: wYear, week: wNum } = getIsoWeek(weekStart);
          currentWeekYear = wYear;
          currentWeekNum  = wNum;
        }

        // 找出所有 createdAt 落在这一天（含北京 00:00~23:59）的周报
        // 注意：weekReport.createdAt 是 UTC 时间，需要在北京时间范围内
        // 北京时间 dayStart = UTC(dayStart) + 8h， 北京时间 dayEnd = UTC(dayEnd) + 8h
        // 但 our allReports 已经按 UTC 排序了，dayStart/dayEnd 也是 UTC
        // 所以直接比较 createdAt UTC 是否在 [dayStart, dayEnd] 之间即可
        const dayReports = allReports.filter(
          (r) => r.createdAt >= dayStart && r.createdAt <= dayEnd
        );

        // 逐条处理（注意去重：同一用户同一天可能提交多条，取第一个）
        const seenToday = new Set<string>();
        for (const r of dayReports) {
          if (!userIds.has(r.userId)) continue; // 过滤掉非正式用户
          if (!seenToday.has(r.userId)) {
            submittedInWeek.add(r.userId);
            seenToday.add(r.userId);
          }
        }

        // 计算周报率
        const submitted = submittedInWeek.size;
        const rate = totalUsers > 0 ? Math.round((submitted / totalUsers) * 100) : 0;

        // 北京时间格式化
        const { year: wsy, month: wsm, day: wsd } = toBeijingYmd(currentWeekStart);
        const { year: wey, month: wem, day: wed } = toBeijingYmd(currentWeekEnd);
        const weekStartLabel = `${wsy}/${wsm}/${wsd}`;
        const weekEndLabel   = `${wey}/${wem}/${wed}`;
        const weekdayLabel = new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          weekday: "short",
        }).format(new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`));
        // ISO 周编号取当天日期（而非周一），用户更直观
        const dayIsoWeek = getIsoWeek(dayStart);
        const dayWeekLabel = `${dayIsoWeek.year}-W${String(dayIsoWeek.week).padStart(2, "0")}`;

        results.push({
          date:     `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          weekLabel:`${dayWeekLabel}`,
          weekday:  weekdayLabel,
          weekStart: weekStartLabel,
          weekEnd:   weekEndLabel,
          totalUsers,
          submitted,
          rate,
        });
      }
    }
  }

  return results;
}

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getIsoWeek(ref: Date): { year: number; week: number } {
  // ISO 8601: 周 W01 包含该年 1 月 4 日，周一为第一天
  const jan4 = new Date(Date.UTC(ref.getUTCFullYear(), 0, 4, 0, 0, 0, 0));
  const jan4Day = jan4.getUTCDay() || 7; // Mon=1 ... Sun=7
  const thursday = new Date(jan4.getTime() + (4 - jan4Day) * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const daysSinceThursday = Math.floor((ref.getTime() - thursday.getTime()) / 86400000);
  const isoWeek = Math.floor(daysSinceThursday / 7) + 1;
  return { year: isoYear, week: isoWeek };
}

// ─────────────────────────────────────────────
// 入口
// ─────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("周报提交率 Backfill（基于 createdAt 累积计算）");
  console.log("=".repeat(60));

  const results = await backfillDailyReportRates();

  if (results.length === 0) {
    console.log("\n无需 backfill。");
    return;
  }

  // 写入 JSON 文件（供报表兜底读取）
  const outputPath = "scripts/.weekly-report-rate-backfill.json";
  const fs = await import("node:fs");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ 结果已写入 ${outputPath}（共 ${results.length} 天）`);

  // 按最近一周分组打印
  console.log("\n最近一周每日周报率：");
  console.log("-".repeat(60));
  const last7 = results.slice(-7);
  console.log(
    `  日期        | 周        | 星期 | 周一范围           | 已提交 | 率   `
  );
  console.log("-".repeat(60));
  for (const r of last7) {
    console.log(
      `  ${r.date} | ${r.weekLabel} | ${r.weekday} | ${r.weekStart} - ${r.weekEnd} | ${String(r.submitted).padStart(2)}/${r.totalUsers} | ${String(r.rate).padStart(3)}%`
    );
  }
}

main().catch(console.error);
