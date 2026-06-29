/**
 * PR2 周报 UI / AI 任务在 features/reports/weekly-reports/
 * PR1 周报 CRUD store 在 features/weekly-reports/（不同根）
 * 之所以这样分：
 *   - PR1 已落盘 features/weekly-reports/lib/weekly-report-store.ts
 *   - 业务聚类页面壳是 app/reports/weekly-reports/
 *   - 那"业务"和"页面壳 API"对齐，全部放 features/reports/weekly-reports/
 *   - PR1 的 store 是跨业务的 helper（未来 PR2+ stats 也会查 WeeklyReport），所以放 features/weekly-reports/lib/
 */

import { prisma } from "@/shared/db/client";
import { getWeekRange, getIsoWeek } from "@/shared/lib/week";

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

export type ReportsStats = {
  kpis:            KpiStats;
  ticketTrend:     number[];          // 近 6 周，按 ISO week 顺序
  projectStatus:    ProjectHealthBucket;
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

type ProjectWithTickets = {
  id: string;
  name: string;
  status: string;
  tickets: { status: string }[];
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
      tickets: { select: { status: true } },
    },
  });
}

async function getAllUsers() {
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

  const reports = await prisma.weeklyReport.findMany({
    where: {
      weekStart: { gte: weekStart },
      weekEnd:   { lte: weekEnd },
    },
    select: { userId: true },
  });

  const submittedIds = new Set(reports.map((r) => r.userId));
  const allUsers = await getAllUsers();

  const submitted = allUsers.filter((u) => submittedIds.has(u.id));
  const missing   = allUsers.filter((u) => !submittedIds.has(u.id));

  return { submitted, missing, weekStart, weekEnd };
}

async function getTicketTrend(weekCount = 6): Promise<number[]> {
  const now = new Date();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  // 预计算 6 个 ISO 周边界，再并行发起 6 次 count
  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const ref = new Date(now.getTime() - (weekCount - 1 - i) * WEEK_MS);
    const { weekStart, weekEnd } = getWeekRange(ref);
    return { gte: weekStart, lt: weekEnd };
  });

  const counts = await Promise.all(
    weeks.map((w) =>
      prisma.ticket.count({
        where: { createdAt: w },
      })
    )
  );
  return counts;
}

// ---------------------------------------------------------------------------
// Main public function
// ---------------------------------------------------------------------------

/**
 * 并行化聚合所有报表统计。
 * 供 app/api/reports/stats/route.ts 调用。
 */
export async function getReportsStats(): Promise<ReportsStats> {
  // 并行发起所有独立查询
  const [
    projects,
    monthlyTickets,
    doneCountMap,
    thisWeekReports,
    ticketTrend,
  ] = await Promise.all([
    getActiveProjects(),
    getMonthlyTicketsCount(),
    getRecentDoneTicketCountByCreator(30),
    getThisWeekReports(),
    getTicketTrend(6),
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

  // --- top members ---
  const allUserIds = [...doneCountMap.keys()];
  const [totalDoneMap, totalCreatedMap, users] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["creatorId"],
      _count: { _all: true },
      where: { creatorId: { in: allUserIds }, status: "DONE" },
    }).then((rows) => new Map(rows.map((r) => [r.creatorId, r._count._all]))),
    prisma.ticket.groupBy({
      by: ["creatorId"],
      _count: { _all: true },
      where: { creatorId: { in: allUserIds } },
    }).then((rows) => new Map(rows.map((r) => [r.creatorId, r._count._all]))),
    prisma.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, name: true, image: true },
    }),
  ]);

  const topMembers: TopMember[] = users
    .map((u) => {
      const done = doneCountMap.get(u.id) ?? 0;
      const total = totalCreatedMap.get(u.id) ?? 0;
      const rate = total > 0 ? Math.round((done / total) * 100) : 0;
      return { userId: u.id, name: u.name, image: u.image, done, rate };
    })
    .filter((m) => m.done > 0)
    .sort((a, b) => b.done - a.done)
    .slice(0, 5);

  return {
    kpis,
    ticketTrend,
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
