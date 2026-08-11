/**
 * features/reports/weekly-reports/lib/context-aggregator.ts
 *
 * PR7 新增：多数据源聚合器。
 *
 * 聚合用户在该周的行为数据：
 * - 工单（被指派或创建的 Ticket）
 * - 笔记（PkmNote）
 * - AI 对话（AiConversation 含 summary）
 * - 站点访问（ActivityLog action=PAGE_VIEW）
 *
 * 缓存机制：进程内 Map，key = `userId:weekStartISO`
 * 缓存值：{ context, hash, computedAt }
 * hash = SHA256 of JSON.stringify(context)，用 node:crypto（后端专用）
 * TTL 5 分钟
 */

import { createHash } from "node:crypto";
import { prisma } from "@/shared/db/client";

// ============================================================
// Types
// ============================================================

export interface TicketItem {
  id: string;
  ticketNo: number;
  title: string;
  status: string;
  projectId: string;
  projectName: string;
  updatedAt: string;
}

export interface NoteItem {
  id: string;
  title: string;
  snippet: string;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  title: string;
  summary: string | null;
  messageCount: number;
  lastMessageAt: string;
}

export interface PageVisitAggregation {
  topProjects: { name: string; visits: number }[];
  validViews: number;
  totalDwellMs: number;
  recentDetails: { targetName: string; dwellMs: number; createdAt: string }[];
}

export interface WeeklyContext {
  weekStart: string;
  weekEnd: string;
  tickets: TicketItem[];
  notes: NoteItem[];
  conversations: ConversationItem[];
  visits: PageVisitAggregation;
  /** 所有涉及的项目 ID（去重），用于自动关联周报 */
  projectIds: string[];
  /** 项目 ID → 名称映射 */
  projectIdToName: Record<string, string>;
}

// ============================================================
// Constants
// ============================================================

const TITLE_MAX = 100;
const SNIPPET_MAX = 200;
const CONTENT_MAX = 200;
const TICKETS_TAKE = 50;
const NOTES_TAKE = 30;
const CONVERSATIONS_TAKE = 20;
const VISITS_RECENT_TAKE = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

interface CacheEntry {
  context: WeeklyContext;
  hash: string;
  computedAt: number;
}

// ============================================================
// In-process cache
// ============================================================

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, weekStart: string): string {
  return `${userId}:${weekStart}`;
}

function computeHash(context: WeeklyContext): string {
  return createHash("sha256").update(JSON.stringify(context), "utf8").digest("hex");
}

function getCached(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.computedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCached(key: string, entry: CacheEntry): void {
  // Evict oldest if cache grows too large
  if (cache.size >= 200) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, entry);
}

export function invalidateContextCache(userId?: string, weekStart?: string): void {
  if (userId && weekStart) {
    cache.delete(cacheKey(userId, weekStart));
  } else if (userId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}

// ============================================================
// Truncation helpers
// ============================================================

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

// ============================================================
// Data source fetchers
// ============================================================

async function fetchTickets(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<TicketItem[]> {
  const rows = await prisma.ticket.findMany({
    where: {
      updatedAt: { gte: weekStart, lte: weekEnd },
      OR: [
        { creatorId: userId },
        { assignees: { some: { userId } } },
      ],
    },
    take: TICKETS_TAKE,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    ticketNo: r.ticketNo,
    title: truncate(r.title, TITLE_MAX),
    status: r.status,
    projectId: r.project.id,
    projectName: r.project.name,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function fetchNotes(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<NoteItem[]> {
  const rows = await prisma.pkmNote.findMany({
    where: {
      userId,
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    take: NOTES_TAKE,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: truncate(r.title, TITLE_MAX),
    snippet: truncate(r.content, SNIPPET_MAX),
    createdAt: r.createdAt.toISOString(),
  }));
}

async function fetchConversations(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<ConversationItem[]> {
  const rows = await prisma.aiConversation.findMany({
    where: {
      userId,
      lastMessageAt: { gte: weekStart, lte: weekEnd },
    },
    take: CONVERSATIONS_TAKE,
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      title: true,
      summary: true,
      messageCount: true,
      lastMessageAt: true,
    },
  });

  return rows.map((r) => {
    let summaryText: string | null = null;
    if (r.summary && typeof r.summary === "object") {
      const s = r.summary as Record<string, unknown>;
      const topics = Array.isArray(s.topics) ? s.topics.join(" / ") : "";
      const keyPoints = Array.isArray(s.keyPoints) ? s.keyPoints.join("；") : "";
      summaryText = [topics, keyPoints].filter(Boolean).join(" | ") || null;
    }
    return {
      id: r.id,
      title: truncate(r.title, TITLE_MAX),
      summary: summaryText ? truncate(summaryText, CONTENT_MAX) : null,
      messageCount: r.messageCount,
      lastMessageAt: r.lastMessageAt.toISOString(),
    };
  });
}

async function fetchVisits(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<PageVisitAggregation> {
  const logs = await prisma.activityLog.findMany({
    where: {
      actorId: userId,
      action: "PAGE_VIEW",
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    orderBy: { createdAt: "desc" },
    select: {
      targetName: true,
      dwellMs: true,
      isValidView: true,
      createdAt: true,
    },
  });

  // topProjects: aggregate by targetName
  const projectMap = new Map<string, number>();
  let validViews = 0;
  let totalDwellMs = 0;

  for (const log of logs) {
    if (log.targetName) {
      projectMap.set(log.targetName, (projectMap.get(log.targetName) ?? 0) + 1);
    }
    if (log.isValidView) validViews++;
    if (log.dwellMs) totalDwellMs += log.dwellMs;
  }

  const topProjects = Array.from(projectMap.entries())
    .map(([name, visits]) => ({ name, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5);

  const recentDetails = logs
    .slice(0, VISITS_RECENT_TAKE)
    .filter((l) => l.targetName)
    .map((l) => ({
      targetName: l.targetName!,
      dwellMs: l.dwellMs ?? 0,
      createdAt: l.createdAt.toISOString(),
    }));

  return { topProjects, validViews, totalDwellMs, recentDetails };
}

// ============================================================
// Main export
// ============================================================

export async function aggregateWeeklyContext(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<WeeklyContext> {
  const weekStartISO = weekStart.toISOString();
  const key = cacheKey(userId, weekStartISO);

  // Check cache
  const cached = getCached(key);
  if (cached) {
    return cached.context;
  }

  // Parallel fetch all sources
  const [tickets, notes, conversations, visits] = await Promise.all([
    fetchTickets(userId, weekStart, weekEnd),
    fetchNotes(userId, weekStart, weekEnd),
    fetchConversations(userId, weekStart, weekEnd),
    fetchVisits(userId, weekStart, weekEnd),
  ]);

  // Extract unique project IDs from tickets and build id→name map
  const projectIdSet = new Set<string>();
  const projectIdToNameMap: Record<string, string> = {};
  for (const t of tickets) {
    if (t.projectId) {
      projectIdSet.add(t.projectId);
      projectIdToNameMap[t.projectId] = t.projectName;
    }
  }

  const context: WeeklyContext = {
    weekStart: weekStartISO,
    weekEnd: weekEnd.toISOString(),
    tickets,
    notes,
    conversations,
    visits,
    projectIds: Array.from(projectIdSet),
    projectIdToName: projectIdToNameMap,
  };

  const hash = computeHash(context);
  setCached(key, { context, hash, computedAt: Date.now() });

  return context;
}
