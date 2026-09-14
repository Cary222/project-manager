/**
 * business_query —— Work 的真实业务只读工具（C7）。
 *
 * 三条硬约束：
 *
 * 1. **ACL 服务端强制**。所有查询都过 DataScope：ROOT 可读全部项目，
 *    普通用户只能读 UserOnProject 成员项目。过滤发生在 Prisma where 里，
 *    不是查完再筛，也绝不靠 LLM prompt 自律。空范围返回 0 行而不是放开。
 *
 * 2. **OVERDUE 用历史事实**。「上个月延期的工单」= TicketStatusHistory.status=OVERDUE
 *    且 createdAt 落在上月北京自然月。若用 Ticket.status=OVERDUE（当前状态）会同时
 *    犯两个错：漏掉曾延期现已关闭的单子，把本月才延期的算进上月。
 *
 * 3. **结果必须可审计**。返回 total / returned / truncated / window / dataScope，
 *    报告必须标注来源与扫描范围。没有"外部工单"这种字段就不假装有 ——
 *    不可表达的概念由 Decision 层升级为澄清，工具端不接受静默降级。
 */

import "server-only";

import { z } from "zod";
import { prisma } from "@/shared/db/client";
import type {
  ToolDefinition,
  ToolExecutionResult,
} from "@/features/ai/runtime/tool-registry";
import { resolveDataScope, type DataScope } from "../runtime/work-run-store";
import {
  resolveTimeWindow,
  WORK_TIMEZONE,
  type TimeWindow,
} from "./time-window";

// ============================================================================
// 入参 schema（与 planner/validate.ts 的目录保持一致）
// ============================================================================

export const TICKET_STATUSES = [
  "DEVELOPING",
  "READY_FOR_TEST",
  "DONE",
  "DELIVERED",
  "OVERDUE",
  "CLOSED",
] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

export const BUSINESS_ENTITIES = [
  "project",
  "ticket",
  "ticket_status_history",
  "meeting",
  "commit",
  "weekly_report",
] as const;

export const QueryArgs = z
  .object({
    entity: z.enum(BUSINESS_ENTITIES),
    /** 限定单个项目；必须在 dataScope 内，越界直接拒绝而不是忽略。 */
    projectId: z.string().max(64).optional(),
    /** 当前状态过滤（ticket 实体）。 */
    status: z.array(z.enum(TICKET_STATUSES)).max(6).optional(),
    /** 历史状态过滤 —— 「上个月延期」必须用这个。 */
    historyStatus: z.enum(TICKET_STATUSES).optional(),
    /** ISO 日期（YYYY-MM-DD）或完整 ISO 时间戳，按 Asia/Shanghai 解释。 */
    since: z.string().max(40).optional(),
    until: z.string().max(40).optional(),
    /** 相对自然月偏移：0=本月，1=上月。与 since/until 互斥。 */
    monthOffset: z.number().int().min(0).max(120).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .refine(
    (v) =>
      v.monthOffset === undefined ||
      (v.since === undefined && v.until === undefined),
    { message: "monthOffset 与 since/until 互斥，只能给一种时间范围" },
  );

export type QueryInput = z.infer<typeof QueryArgs>;

const DEFAULT_LIMIT = 100;

// ============================================================================
// 结果结构
// ============================================================================

export interface BusinessQueryDetails {
  entity: QueryInput["entity"];
  window: {
    label: string;
    since: string;
    until: string;
    source: TimeWindow["source"];
  };
  dataScope: {
    mode: DataScope["mode"];
    projectCount: number;
    truncated: boolean;
  };
  /** 命中总数（独立 count 查询，不受 limit 影响）。 */
  total: number;
  returned: number;
  truncated: boolean;
  items: Record<string, unknown>[];
  timezone: string;
}

/**
 * 「无任何可见项目」的哨兵 id。
 * 用不可能命中的值而不是空数组：`in: []` 与"不加约束"在语义上都是空集，
 * 一旦有人把 undefined 与空数组搞混，ACL 就会静默放开成全量。
 * 这里让"无权限"永远是一个显式的、必然查不到任何东西的 id。
 */
export const NO_ACCESS_SENTINEL = "__no_access__";

/**
 * ACL：把 DataScope 变成 projectId 白名单。
 * ROOT（all_projects）返回 undefined = 不加约束；
 * 普通用户返回成员项目 id 列表；一个项目都没有 → 哨兵，查不到任何数据。
 */
export function projectIdFilter(
  scope: DataScope,
  requested?: string,
): string[] | undefined {
  if (requested) {
    // 显式指定项目：越界不给"看得到就查"的机会，直接返回哨兵。
    if (
      scope.mode !== "all_projects" &&
      !scope.projectIds.includes(requested)
    ) {
      return [NO_ACCESS_SENTINEL];
    }
    return [requested];
  }
  if (scope.mode === "all_projects") return undefined;
  if (scope.projectIds.length === 0) return [NO_ACCESS_SENTINEL];
  return scope.projectIds;
}

async function currentRole(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role ?? "USER";
}

// ============================================================================
// 查询核心（独立导出便于单测，不依赖 ToolExecutionContext）
// ============================================================================

export type BusinessQueryOutcome =
  | { ok: true; details: BusinessQueryDetails; content: string }
  | { ok: false; error: string };

export async function runBusinessQuery(
  userId: string,
  rawArgs: unknown,
): Promise<BusinessQueryOutcome> {
  const parsed = QueryArgs.safeParse(rawArgs);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `参数非法 — ${detail}` };
  }
  const args = parsed.data;

  const windowRes = resolveTimeWindow(args);
  if (!windowRes.ok) return { ok: false, error: windowRes.error };
  const win = windowRes.window;

  const role = await currentRole(userId);
  const scope = await resolveDataScope(userId, role);

  // 显式 projectId 越权：直接拒绝，不静默改查全部。
  if (
    args.projectId &&
    scope.mode !== "all_projects" &&
    !scope.projectIds.includes(args.projectId)
  ) {
    return { ok: false, error: `无权访问项目 ${args.projectId}` };
  }

  const limit = args.limit ?? DEFAULT_LIMIT;
  const pidFilter = projectIdFilter(scope, args.projectId);
  const range = { gte: win.since, lte: win.until };

  let total = 0;
  let items: Record<string, unknown>[] = [];

  switch (args.entity) {
    case "project": {
      const where = pidFilter ? { id: { in: pidFilter } } : {};
      total = await prisma.project.count({ where });
      const rows = await prisma.project.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          ownerId: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: limit + 1,
      });
      items = rows.map((r) => ({ ...r }));
      break;
    }

    case "ticket": {
      const where = {
        ...(pidFilter ? { projectId: { in: pidFilter } } : {}),
        ...(args.status?.length ? { status: { in: args.status } } : {}),
        updatedAt: range,
      };
      total = await prisma.ticket.count({ where });
      const rows = await prisma.ticket.findMany({
        where,
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          priority: true,
          deadline: true,
          progress: true,
          projectId: true,
          updatedAt: true,
          project: { select: { name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: limit + 1,
      });
      items = rows.map((r) => ({ ...r, projectName: r.project?.name }));
      break;
    }

    case "ticket_status_history": {
      // 历史事实：状态变更事件本身落在时间窗内。
      if (!args.historyStatus) {
        return {
          ok: false,
          error:
            "ticket_status_history 必须给 historyStatus（要统计哪种历史状态，如 OVERDUE）",
        };
      }
      const where = {
        status: args.historyStatus,
        createdAt: range,
        ...(pidFilter ? { ticket: { projectId: { in: pidFilter } } } : {}),
      };
      total = await prisma.ticketStatusHistory.count({ where });
      const rows = await prisma.ticketStatusHistory.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          status: true,
          changedById: true,
          ticket: {
            select: {
              id: true,
              ticketNo: true,
              title: true,
              status: true,
              deadline: true,
              priority: true,
              projectId: true,
              project: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      });
      items = rows.map((r) => ({
        changedAt: r.createdAt,
        historyStatus: r.status,
        changedById: r.changedById,
        ticketId: r.ticket?.id,
        ticketNo: r.ticket?.ticketNo,
        title: r.ticket?.title,
        currentStatus: r.ticket?.status,
        deadline: r.ticket?.deadline,
        priority: r.ticket?.priority,
        projectId: r.ticket?.projectId,
        projectName: r.ticket?.project?.name,
      }));
      break;
    }

    case "meeting": {
      const where = {
        ...(pidFilter ? { projectId: { in: pidFilter } } : {}),
        meetingDate: range,
      };
      total = await prisma.projectMeeting.count({ where });
      const rows = await prisma.projectMeeting.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          meetingDate: true,
          projectId: true,
          publishedAt: true,
          project: { select: { name: true } },
        },
        orderBy: { meetingDate: "desc" },
        take: limit + 1,
      });
      items = rows.map((r) => ({ ...r, projectName: r.project?.name }));
      break;
    }

    case "commit": {
      // TicketCommit 没有 projectId，只能经 ticket 关联做 ACL。
      const where = {
        committedAt: range,
        ...(pidFilter ? { ticket: { projectId: { in: pidFilter } } } : {}),
      };
      total = await prisma.ticketCommit.count({ where });
      const rows = await prisma.ticketCommit.findMany({
        where,
        select: {
          id: true,
          commitSha: true,
          subject: true,
          author: true,
          committedAt: true,
          repoPath: true,
          branches: true,
          ticketNo: true,
          ticket: {
            select: {
              id: true,
              title: true,
              projectId: true,
              project: { select: { name: true } },
            },
          },
        },
        orderBy: { committedAt: "desc" },
        take: limit + 1,
      });
      items = rows.map((r) => ({
        ...r,
        projectName: r.ticket?.project?.name,
        projectId: r.ticket?.projectId,
      }));
      break;
    }

    case "weekly_report": {
      // 周报按作者归属，不按项目 ACL；只能读自己的。
      // 这是既有行为，不在此处放宽。
      const where = { userId, weekStart: range };
      total = await prisma.weeklyReport.count({ where });
      const rows = await prisma.weeklyReport.findMany({
        where,
        select: {
          id: true,
          title: true,
          weekStart: true,
          weekEnd: true,
          createdAt: true,
          aiSummary: true,
        },
        orderBy: { weekStart: "desc" },
        take: limit + 1,
      });
      items = rows.map((r) => ({ ...r }));
      break;
    }
  }

  const truncated = items.length > limit;
  if (truncated) items = items.slice(0, limit);

  const details: BusinessQueryDetails = {
    entity: args.entity,
    window: {
      label: win.label,
      since: win.since.toISOString(),
      until: win.until.toISOString(),
      source: win.source,
    },
    dataScope: {
      mode: scope.mode,
      // all_projects 用 -1 表示"不限"，避免看起来像"只有 N 个"。
      projectCount:
        scope.mode === "all_projects" ? -1 : scope.projectIds.length,
      truncated: scope.truncated,
    },
    total,
    returned: items.length,
    truncated,
    items,
    timezone: WORK_TIMEZONE,
  };

  const scopeNote =
    scope.mode === "all_projects"
      ? "全部项目（ROOT）"
      : `成员项目 ${scope.projectIds.length} 个${scope.truncated ? "（已截断）" : ""}`;
  const content = [
    `${args.entity} 查询完成`,
    `时间范围: ${win.label}`,
    `数据权限: ${scopeNote}`,
    `命中总数: ${total}，返回: ${items.length}${truncated ? `（已截断，limit=${limit}）` : ""}`,
  ].join("\n");

  return { ok: true, details, content };
}

// ============================================================================
// Tool 工厂
// ============================================================================

export function createBusinessQueryTool(): ToolDefinition<BusinessQueryDetails | null> {
  return {
    name: "business_query",
    description:
      "查询项目/工单/工单状态历史/会议/Git提交/周报等结构化业务数据（服务端强制数据权限，只读）",
    inputSchema: QueryArgs,
    permission: "read",
    agentTypes: ["WORK"],
    async execute(
      ctx,
      args,
    ): Promise<ToolExecutionResult<BusinessQueryDetails | null>> {
      const res = await runBusinessQuery(ctx.userId, args);
      if (!res.ok) {
        // 失败时没有可用 details —— 类型允许 null，靠 isError 传达失败。
        return {
          content: res.error,
          details: null,
          isError: true,
        };
      }
      return { content: res.content, details: res.details };
    },
  };
}
