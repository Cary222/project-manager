/**
 * PR2 周报 UI / AI 任务在 features/reports/weekly-reports/
 * PR1 周报 CRUD store 在 features/weekly-reports/（不同根）
 * 之所以这样分：
 *   - PR1 已落盘 features/weekly-reports/lib/weekly-report-store.ts
 *   - 业务聚类页面壳是 app/reports/weekly-reports/
 *   - 那"业务"和"页面壳 API"对齐，全部放 features/reports/weekly-reports/
 *   - PR1 的 store 是跨业务的 helper（未来 PR2+ stats 也会查 WeeklyReport），所以放 features/weekly-reports/lib/
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/shared/db/client";
import { getWeekRange, getIsoWeek } from "@/shared/lib/week";

// ---------------------------------------------------------------------------
// Backfill 兜底：读取预计算的每日周报率 JSON
// ---------------------------------------------------------------------------
// scripts/backfill-weekly-report-rate.ts 运行后会生成该文件。
// 每天实时计算（getDailyTrend）若 DB 数据异常，可降级读取此文件作为兜底。
interface BackfillDay {
  date: string;       // "2026-07-03"
  submitted: number;
  totalUsers: number;
  rate: number;
}

function readBackfill(date: string): BackfillDay | null {
  try {
    const filePath = join(process.cwd(), "scripts", ".weekly-report-rate-backfill.json");
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const data: BackfillDay[] = JSON.parse(raw);
    return data.find((d) => d.date === date) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KpiStats = {
  activeProjects: number;
  completionRate: number;       // 0-100
  monthlyTickets: number;
  teamHealth: number;            // 0-100, ROOT only
};

export type ProjectHealthBucket = {
  good: number;
  normal: number;
  attention: number;
  risk: number;
};

export type ProjectHealthDetail = {
  id: string;
  name: string;
  progress: number;   // 0-100
  status: "good" | "normal" | "attention" | "risk";
};

export type TopMember = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  done: number;
  rate: number;       // 完成率 0-100
};

export type WeeklyReportStatus = {
  submitted: Array<{ id: string; name: string | null; email: string; image: string | null }>;
  missing:   Array<{ id: string; name: string | null; email: string; image: string | null }>;
  weekStart: Date;
  weekEnd:   Date;
};

export type WeeklySubmissionTrend = {
  week: string;       // e.g. "2026-W26"
  rate: number;
  submitted: number;
  total: number;
};

// 周情况（按周聚合）
export type WeeklyTrend = {
  week: string;
  tickets: number;    // 新建任务数
  done: number;       // 完成任务数
  reportRate: number; // 周报提交率 0-100
};

// 月度数据
export type MonthlyTrend = {
  month: string;      // e.g. "2026-06"
  tickets: number;
  done: number;
  reportRate: number;
  contribution?: number; // 月贡献（可选，用于图表显示）
};

// 当日数据
export type TodayStats = {
  date: string;       // e.g. "2026-06-29"
  tickets: number;   // 新建任务数
  done: number;      // 完成任务数
  reportSubmitted: boolean; // 今日是否已提交周报（针对当前用户）
};

// 每日趋势数据
export type DailyTrend = {
  date: string;       // 短标签: e.g. "6/29"
  fullLabel: string;  // 完整标签：e.g. "2026年6月29日"
  tickets: number;
  done: number;      // 当日完成任务数
  reportRate: number;
  contribution?: number; // 当日贡献（可选，用于图表显示）
};

function toUtcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getDate(), 0, 0, 0, 0));
}

function toUtcEndOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getDate(), 23, 59, 59, 999));
}

/** 按日聚合数据（用于本周视图）
 *
 * 每日周报率 = 截止当天（含）已提交周报的去重人数 / 总人数。
 * 例：周一 3 人提交 → 周一率 3/18；周二又有 2 人提交 → 周二率 5/18。
 */
/** 获取 UTC 日期所在周的开始日期（周一） */
function getWeekStart(date: Date): Date {
  const { weekStart } = getWeekRange(date);
  return weekStart;
}

export async function getDailyTrend(days = 7): Promise<DailyTrend[]> {
  const now = new Date();
  const todayUtc = toUtcStartOfDay(now);
  const allUsers = await getAllUsers();
  const total = allUsers.length;
  const { weekStart: currentWeekStart } = getWeekRange(now);

  // 生成本周 days 天的数据点（不含未来日期）
  const daysData = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(
      currentWeekStart.getUTCFullYear(),
      currentWeekStart.getUTCMonth(),
      currentWeekStart.getUTCDate() + i,
    ));
    const start = toUtcStartOfDay(d);
    const end = toUtcEndOfDay(d);
    const isFuture = start.getTime() > todayUtc.getTime();
    const shortLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const fullLabel = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
    return { start, end, shortLabel, fullLabel, isFuture };
  }).filter((d) => !d.isFuture);

  const validDays = daysData.length;

  const [createdCounts, doneCounts] = await Promise.all([
    Promise.all(daysData.map((d) =>
      prisma.ticket.count({ where: { createdAt: { gte: d.start, lte: d.end } } })
    )),
    Promise.all(daysData.map((d) =>
      prisma.ticketStatusHistory.count({
        where: { status: "DONE", createdAt: { gte: d.start, lte: d.end } },
      })
    )),
  ]);

  // 按 createdAt 排序，一次性取出本周所有周报（用于计算每日累积）
  const weekReports = await prisma.weeklyReport.findMany({
    where: { createdAt: { gte: daysData[0].start, lte: daysData[validDays - 1].end } },
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // 按天遍历，每一天取月初~该天的所有周报，计算累积用户数
  const cumulative: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < validDays; i++) {
    // 包含月初到第 i 天的所有周报
    const reportsUpToDay = weekReports.filter(
      (r) => r.createdAt.getTime() <= daysData[i].end.getTime()
    );
    for (const r of reportsUpToDay) {
      seen.add(r.userId);
    }
    cumulative[i] = seen.size;
  }

  return daysData.map((d, i) => {
    const computedRate = total > 0 ? Math.round((cumulative[i] / total) * 100) : 0;
    const dateStr = `${d.start.getUTCFullYear()}-${String(d.start.getUTCMonth() + 1).padStart(2, "0")}-${String(d.start.getUTCDate()).padStart(2, "0")}`;
    const backfill = readBackfill(dateStr);
    const rate = backfill && backfill.rate > 0 && backfill.totalUsers === total
      ? backfill.rate
      : computedRate;
    return {
      date: d.shortLabel,
      fullLabel: d.fullLabel,
      tickets: createdCounts[i],
      done: doneCounts[i],
      reportRate: rate,
      contribution: doneCounts[i],
    };
  });
}

/** 按月内每日聚合数据（用于本月视图）
 *
 * 图表按周分段，每周内按天累积计算周报率，跨周时重新开始。
 * 效果：本周7天显示每日累积值，跨周后重新从0开始。
 */
export async function getMonthDailyTrend(monthOffset = 0): Promise<DailyTrend[]> {
  const now = new Date();
  const todayUtc = toUtcStartOfDay(now);
  const targetMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1));
  const endOfMonth = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0));
  const daysInMonth = endOfMonth.getUTCDate();

  const allUsers = await getAllUsers();
  const total = allUsers.length;

  // 生成本月每天的数据点（不含未来日期）
  const daysData = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), i + 1));
    const start = toUtcStartOfDay(d);
    const end = toUtcEndOfDay(d);
    const isFuture = start.getTime() > todayUtc.getTime();
    const shortLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const fullLabel = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
    return { start, end, shortLabel, fullLabel, isFuture };
  }).filter((d) => !d.isFuture);

  const validDays = daysData.length;

  const [createdCounts, doneCounts] = await Promise.all([
    Promise.all(daysData.map((d) =>
      prisma.ticket.count({ where: { createdAt: { gte: d.start, lte: d.end } } })
    )),
    Promise.all(daysData.map((d) =>
      prisma.ticketStatusHistory.count({
        where: { status: "DONE", createdAt: { gte: d.start, lte: d.end } },
      })
    )),
  ]);

  // 按周分组
  const weekBuckets: { weekStart: Date; weekEnd: Date; days: number[] }[] = [];
  let currentWeekStart: Date | null = null;
  let currentWeekEnd: Date | null = null;
  let currentDays: number[] = [];

  for (let i = 0; i < validDays; i++) {
    const d = daysData[i];
    const weekStart = getWeekStart(d.start);
    if (currentWeekStart === null) {
      currentWeekStart = weekStart;
      currentWeekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      currentDays = [];
    }
    if (weekStart.getTime() > currentWeekStart.getTime()) {
      weekBuckets.push({ weekStart: currentWeekStart, weekEnd: currentWeekEnd!, days: currentDays });
      currentWeekStart = weekStart;
      currentWeekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
      currentDays = [];
    }
    currentDays.push(i);
  }
  if (currentDays.length > 0) {
    weekBuckets.push({ weekStart: currentWeekStart!, weekEnd: currentWeekEnd!, days: currentDays });
  }

  // 对每个周 bucket，计算每日累积周报率
  const result: DailyTrend[] = [];
  for (const bucket of weekBuckets) {
    const bucketDays = bucket.days.map((i) => daysData[i]);
    const bucketValidDays = bucketDays.length;

    // 按 createdAt 取该周内的周报
    const weekReports = await prisma.weeklyReport.findMany({
      where: { createdAt: { gte: bucketDays[0].start, lte: bucketDays[bucketValidDays - 1].end } },
      select: { userId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // 每日累积
    // 按天遍历，每一天取月初~该天的所有周报，计算累积用户数
    const cumulative: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < bucketValidDays; i++) {
      // 包含月初到第 i 天的所有周报
      const reportsUpToDay = weekReports.filter(
        (r) => r.createdAt.getTime() <= bucketDays[i].end.getTime()
      );
      for (const r of reportsUpToDay) {
        seen.add(r.userId);
      }
      cumulative[i] = seen.size;
    }

    for (let i = 0; i < bucketValidDays; i++) {
      const idx = bucket.days[i];
      const computedRate = total > 0 ? Math.round((cumulative[i] / total) * 100) : 0;
      const dateStr = `${daysData[idx].start.getUTCFullYear()}-${String(daysData[idx].start.getUTCMonth() + 1).padStart(2, "0")}-${String(daysData[idx].start.getUTCDate()).padStart(2, "0")}`;
      const backfill = readBackfill(dateStr);
      const rate = backfill && backfill.rate > 0 && backfill.totalUsers === total
        ? backfill.rate
        : computedRate;
      result.push({
        date: daysData[idx].shortLabel,
        fullLabel: daysData[idx].fullLabel,
        tickets: createdCounts[idx],
        done: doneCounts[idx],
        reportRate: rate,
        contribution: doneCounts[idx],
      });
    }
  }

  return result;
}

// 贡献排名（支持周/月）
export type MemberContribution = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  done: number;
  total: number;
  rate: number;
};

export type ReportsStats = {
  kpis:            KpiStats;
  weeklyTrend:     WeeklyTrend[];
  monthlyTrend:    MonthlyTrend[];
  projectStatus:   ProjectHealthBucket;
  projectHealth:   ProjectHealthDetail[];
  topMembers:      TopMember[];
  thisWeekReports: WeeklyReportStatus;
};

export type HealthSummary = {
  summary:     string;
  generatedAt: Date;
  fromCache:   boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get the latest "DONE" timestamp for a ticket from its status history.
 * Returns null if the ticket was never marked as DONE.
 */
export async function getLatestDoneAt(ticketId: string): Promise<Date | null> {
  const history = await prisma.ticketStatusHistory.findFirst({
    where: { ticketId, status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return history?.createdAt ?? null;
}

type ProjectWithTickets = {
  id: string;
  name: string;
  status: string;
  tickets: { status: string; createdAt: Date }[];
};

/** 计算单个项目的健康度分桶 */
function bucketByProgress(done: number, total: number): "good" | "normal" | "attention" | "risk" {
  if (total === 0) return "normal";
  const rate = (done / total) * 100;
  if (rate >= 80) return "good";
  if (rate >= 60) return "normal";
  if (rate >= 40) return "attention";
  return "risk";
}

/** 计算单个项目的完成进度百分比 */
function calcProjectProgress(project: ProjectWithTickets): number {
  const total = project.tickets.length;
  if (total === 0) return 0;
  const done = project.tickets.filter((t) => t.status === "DONE").length;
  return Math.round((done / total) * 100);
}

// ---------------------------------------------------------------------------
// Parallel data fetch
// ---------------------------------------------------------------------------

async function getActiveProjects(): Promise<ProjectWithTickets[]> {
  return prisma.project.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      status: true,
      tickets: { select: { status: true, createdAt: true } },
    },
  });
}

export type UserSummary = { id: string; name: string | null; email: string; image: string | null };

async function getAllUsers(): Promise<UserSummary[]> {
  return prisma.user.findMany({
    where: { bannedAt: null },
    select: { id: true, name: true, email: true, image: true },
  });
}

async function getMonthlyTicketsCount(): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return prisma.ticket.count({
    where: { createdAt: { gte: startOfMonth } },
  });
}

async function getRecentDoneTicketCountByCreator(days = 30): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const tickets = await prisma.ticket.findMany({
    where: { status: "DONE", createdAt: { gte: since } },
    select: { creatorId: true },
  });
  const map = new Map<string, number>();
  for (const t of tickets) {
    map.set(t.creatorId, (map.get(t.creatorId) ?? 0) + 1);
  }
  return map;
}

async function getThisWeekReports() {
  const { weekStart, weekEnd } = getWeekRange(new Date());

  // 判断"本周是否提交"的标准：
  // 只要该用户在当前日历周内有任意一条周报记录（createdAt 在本周范围内），就算提交。
  // 这样不受用户提交时日期选择器的影响——用户可能选上周日期提交，但系统按创建时间判断。
  const reports = await prisma.weeklyReport.findMany({
    where: {
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  const submittedIds = new Set(reports.map((r: { userId: string }) => r.userId));
  const allUsers = await getAllUsers();

  const submitted = allUsers.filter((u) => submittedIds.has(u.id));
  const missing   = allUsers.filter((u) => !submittedIds.has(u.id));

  return { submitted, missing, weekStart, weekEnd };
}

// 按周聚合（近 6 周）
async function getWeeklyTrend(weekCount = 6): Promise<WeeklyTrend[]> {
  const now = new Date();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const allUsers = await getAllUsers();
  const total = allUsers.length;

  const weekData = Array.from({ length: weekCount }, (_, i) => {
    const ref = new Date(now.getTime() - (weekCount - 1 - i) * WEEK_MS);
    const { weekStart, weekEnd } = getWeekRange(ref);
    const isoWeek = getIsoWeek(ref);
    const weekLabel = `${isoWeek.year}-W${String(isoWeek.week).padStart(2, "0")}`;
    return { weekStart, weekEnd, week: weekLabel };
  });

  const [createdCounts, reportCounts] = await Promise.all([
    Promise.all(weekData.map((w) =>
      prisma.ticket.count({ where: { createdAt: { gte: w.weekStart, lt: w.weekEnd } } })
    )),
    Promise.all(weekData.map((w) =>
      prisma.weeklyReport.findMany({
        where: { createdAt: { gte: w.weekStart, lt: w.weekEnd } },
        distinct: ["userId"],
        select: { userId: true },
      })
    )),
  ]);

  // 通过 TicketStatusHistory 查询完成数
  const doneCounts = await Promise.all(weekData.map((w) =>
    prisma.ticketStatusHistory.count({
      where: {
        status: "DONE",
        createdAt: { gte: w.weekStart, lt: w.weekEnd },
      },
    })
  ));

  return weekData.map((w, i) => ({
    week: w.week,
    tickets: createdCounts[i],
    done: doneCounts[i],
    reportRate: total > 0 ? Math.round((reportCounts[i].length / total) * 100) : 0,
  }));
}

// 按月聚合（近 6 月）
async function getMonthlyTrend(monthCount = 6): Promise<MonthlyTrend[]> {
  const now = new Date();
  const months = Array.from({ length: monthCount }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthCount - 1 - i), 1));
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { start, end, label };
  });

  // 周报按月聚合（以月内 createdAt 为准；按 DISTINCT userId，同一用户多份只算1次）
  const allUsers = await getAllUsers();
  const total = allUsers.length;

  const reportCounts = await Promise.all(months.map(async (m) => {
    const firstWeek = getWeekRange(m.start);
    const lastWeek = getWeekRange(m.end);
    return prisma.weeklyReport.findMany({
      where: { createdAt: { gte: firstWeek.weekStart, lte: lastWeek.weekEnd } },
      distinct: ["userId"],
      select: { userId: true },
    });
  }));

  // 通过 TicketStatusHistory 查询月完成数
  const doneCounts = await Promise.all(months.map((m) =>
    prisma.ticketStatusHistory.count({
      where: {
        status: "DONE",
        createdAt: { gte: m.start, lte: m.end },
      },
    })
  ));

  // 按月查询新建任务数
  const createdCounts = await Promise.all(months.map((m) =>
    prisma.ticket.count({ where: { createdAt: { gte: m.start, lte: m.end } } })
  ));

  return months.map((m, i) => ({
    month: m.label,
    tickets: createdCounts[i],
    done: doneCounts[i],
    reportRate: total > 0 ? Math.round((reportCounts[i].length / total) * 100) : 0,
    contribution: doneCounts[i], // 贡献 = 当月完成数
  }));
}

// 当日数据查询
export async function getTodayStats(userId?: string): Promise<TodayStats> {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getDate(), 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getDate(), 23, 59, 59, 999));
  const dateLabel = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const [createdToday, doneToday] = await Promise.all([
    prisma.ticket.count({
      where: { createdAt: { gte: startOfDay, lte: endOfDay } },
    }),
    prisma.ticketStatusHistory.count({
      where: {
        status: "DONE",
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
    }),
  ]);

  // 检查当前用户今日是否已提交周报
  let reportSubmitted = false;
  if (userId) {
    const { weekStart, weekEnd } = getWeekRange(now);
    const report = await prisma.weeklyReport.findFirst({
      where: {
        userId,
        weekStart: { gte: weekStart },
        weekEnd: { lte: weekEnd },
      },
    });
    reportSubmitted = !!report;
  }

  return {
    date: dateLabel,
    tickets: createdToday,
    done: doneToday,
    reportSubmitted,
  };
}

// 贡献排名（近 N 天）
async function getMemberContributions(days = 7): Promise<MemberContribution[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const users = await getAllUsers();
  const userIds = users.map((u) => u.id);

  // 查询期间创建的所有任务
  const createdTickets = await prisma.ticket.findMany({
    where: { creatorId: { in: userIds }, createdAt: { gte: since } },
    select: { id: true, creatorId: true, status: true },
  });

  // 查询期间有 DONE 状态变更的任务（通过 TicketStatusHistory）
  const doneTicketIds = new Set(
    await prisma.ticketStatusHistory.findMany({
      where: { status: "DONE", createdAt: { gte: since } },
      select: { ticketId: true },
    }).then((rows: { ticketId: string }[]) => rows.map((r) => r.ticketId))
  );

  // 按创建者聚合
  const doneMap = new Map<string, number>();
  const totalMap = new Map<string, number>();
  for (const t of createdTickets) {
    totalMap.set(t.creatorId, (totalMap.get(t.creatorId) ?? 0) + 1);
    if (t.status === "DONE" || doneTicketIds.has(t.id)) {
      doneMap.set(t.creatorId, (doneMap.get(t.creatorId) ?? 0) + 1);
    }
  }

  return users
    .map((u) => {
      const done = doneMap.get(u.id) ?? 0;
      const total = totalMap.get(u.id) ?? 0;
      const rate = total > 0 ? Math.round((done / total) * 100) : 0;
      return { userId: u.id, name: u.name, email: u.email, image: u.image, done, total, rate };
    })
    .sort((a, b) => b.done - a.done)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Main public function
// ---------------------------------------------------------------------------

/**
 * 并行化聚合所有报表统计。
 * 供 app/api/reports/stats/route.ts 调用。
 */
export async function getReportsStats(): Promise<ReportsStats> {
  const [
    projects,
    monthlyTickets,
    thisWeekReports,
    weeklyTrend,
    monthlyTrend,
    topMembersRaw,
  ] = await Promise.all([
    getActiveProjects(),
    getMonthlyTicketsCount(),
    getThisWeekReports(),
    getWeeklyTrend(6),
    getMonthlyTrend(6),
    getMemberContributions(30),
  ]);

  // --- project status breakdown ---
  const projectHealth: ProjectHealthDetail[] = projects.map((p) => {
    const total = p.tickets.length;
    const done  = p.tickets.filter((t) => t.status === "DONE").length;
    const progress = calcProjectProgress(p);
    const bucket = bucketByProgress(done, total);
    return { id: p.id, name: p.name, progress, status: bucket };
  });

  const projectStatus: ProjectHealthBucket = {
    good:      projectHealth.filter((p) => p.status === "good").length,
    normal:    projectHealth.filter((p) => p.status === "normal").length,
    attention: projectHealth.filter((p) => p.status === "attention").length,
    risk:      projectHealth.filter((p) => p.status === "risk").length,
  };

  // --- KPIs ---
  const totalTickets = projects.reduce((sum, p) => sum + p.tickets.length, 0);
  const doneTickets  = projects.reduce(
    (sum, p) => sum + p.tickets.filter((t) => t.status === "DONE").length, 0
  );
  const completionRate = totalTickets > 0
    ? Math.round((doneTickets / totalTickets) * 100)
    : 0;

  const kpis: KpiStats = {
    activeProjects:  projects.length,
    completionRate,
    monthlyTickets,
    teamHealth: 0,   // ROOT only, filled by caller based on session
  };

  // --- top members (30-day) ---
  const topMembers: TopMember[] = topMembersRaw.map((m) => ({
    userId: m.userId,
    name: m.name,
    image: m.image,
    done: m.done,
    rate: m.rate,
    email: m.email,
  }));

  return {
    kpis,
    weeklyTrend,
    monthlyTrend,
    projectStatus,
    projectHealth,
    topMembers,
    thisWeekReports: {
      submitted: thisWeekReports.submitted,
      missing:   thisWeekReports.missing,
      weekStart: thisWeekReports.weekStart,
      weekEnd:   thisWeekReports.weekEnd,
    },
  };
}

// ---------------------------------------------------------------------------
// Period-based stats for Dashboard
// ---------------------------------------------------------------------------

export type WeeklyStats = {
  weeklyTrend: WeeklyTrend[];      // 近 6 周趋势（用于本周视图：本周为单日数据替换）
  monthlyTrend: MonthlyTrend[];     // 近 6 月趋势（用于半年视图）
  dailyTrend: DailyTrend[];        // 本周每日数据（用于本周视图）
  contributions: MemberContribution[];
  thisWeekReports: {
    submitted: UserSummary[];
    missing: UserSummary[];
    weekStart: Date;
    weekEnd: Date;
  };
};

/** 本周数据（本周每日 + 近 6 周趋势） */
export async function getWeeklyStats(): Promise<WeeklyStats> {
  const [weeklyTrend, monthlyTrend, dailyTrend, contributions, thisWeekReports] = await Promise.all([
    getWeeklyTrend(6),
    getMonthlyTrend(6),
    getDailyTrend(7),
    getMemberContributions(7),
    getThisWeekReports(),
  ]);

  return {
    weeklyTrend,
    monthlyTrend,
    dailyTrend,
    contributions,
    thisWeekReports,
  };
}

/** 本月数据（当月每日 + 近 6 月趋势） */
export async function getMonthlyStats(monthOffset = 0): Promise<WeeklyStats> {
  const [monthlyTrend, dailyTrend, contributions, thisWeekReports] = await Promise.all([
    getMonthlyTrend(6),
    getMonthDailyTrend(monthOffset),
    getMemberContributions(30),
    getThisWeekReports(),
  ]);

  return {
    weeklyTrend: [], // 本月视图不需要周趋势
    monthlyTrend,
    dailyTrend,
    contributions,
    thisWeekReports,
  };
}

/** 近 6 个月数据（按月聚合） */
export async function getHalfYearStats(): Promise<WeeklyStats> {
  const [monthlyTrend, contributions, thisWeekReports] = await Promise.all([
    getMonthlyTrend(6),
    getMemberContributions(180),
    getThisWeekReports(),
  ]);

  return {
    weeklyTrend: [], // 半年视图不需要周趋势
    monthlyTrend,
    dailyTrend: [],  // 半年视图不需要日趋势
    contributions,
    thisWeekReports,
  };
}
