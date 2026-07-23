import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/shared/db/client";

// ---------------------------------------------------------------------------
// Return types — structured results with source references
// ---------------------------------------------------------------------------

interface SourceReference {
  index: number;
  title: string;
  url: string;
  type: "ticket" | "project" | "user" | "commit" | "weekly_report";
}

interface UserActivityAttribution {
  kind: "user_activity";
  targetUserName: string;
  windowLabel: string;
  hasDirectEvidence: boolean;
  directNoteCount: number;
  relatedTicketCount: number;
  relatedCommitCount: number;
}

interface StructuredResult {
  summary: string;
  sources: SourceReference[];
  attribution?: UserActivityAttribution;
}

/**
 * searchStructured uses a module-scoped viewerUserId that's injected per-request
 * via `setSearchStructuredViewer()`. This is because Agnes does NOT support
 * `contextSchema` (Vercel AI SDK extension), so we cannot pass runtime context
 * through toolsContext.
 */
let currentViewerUserId: string | null = null;
export function setSearchStructuredViewer(userId: string | null) {
  currentViewerUserId = userId;
}

/** Resolves a user identifier (name/email prefix/id) to a user record. */
async function resolveUser(
  identifier: string | undefined,
  viewerUserId: string | undefined
): Promise<{ id: string; name: string } | null> {
  if (!identifier) return null;
  const trimmed = identifier.trim();
  // Try exact id match first
  const byId = await prisma.user.findUnique({
    where: { id: trimmed },
    select: { id: true, name: true },
  });
  if (byId) return { id: byId.id, name: byId.name ?? byId.id };

  // Try name match (case-insensitive)
  const byName = await prisma.user.findFirst({
    where: {
      name: { equals: trimmed, mode: "insensitive" },
      bannedAt: null,
    },
    select: { id: true, name: true },
  });
  if (byName) return { id: byName.id, name: byName.name ?? byName.id };

  // Try contains match for partial Chinese names / nicknames (e.g. "敏捷" → "许敏捷")
  if (trimmed.length >= 1) {
    const byContains = await prisma.user.findFirst({
      where: {
        name: { contains: trimmed, mode: "insensitive" },
        bannedAt: null,
      },
      select: { id: true, name: true },
    });
    if (byContains) return { id: byContains.id, name: byContains.name ?? byContains.id };
  }

  // Try email prefix match
  const byEmailPrefix = await prisma.user.findFirst({
    where: {
      email: { startsWith: trimmed, mode: "insensitive" },
      bannedAt: null,
    },
    select: { id: true, name: true },
  });
  if (byEmailPrefix) return { id: byEmailPrefix.id, name: byEmailPrefix.name ?? byEmailPrefix.id };

  // 5. Email contains match (works for partial email or any string with @/.)
  if (trimmed.includes("@") || trimmed.includes(".")) {
    const byEmailContains = await prisma.user.findFirst({
      where: {
        email: { contains: trimmed, mode: "insensitive" },
        bannedAt: null,
      },
      select: { id: true, name: true },
    });
    if (byEmailContains) return { id: byEmailContains.id, name: byEmailContains.name ?? byEmailContains.id };
  }

  return null;
}

/** Returns a short list of candidate users for the model to consider / ask the user to disambiguate. */
async function listCandidateUsers(identifier: string): Promise<string> {
  const users = await prisma.user.findMany({
    where: {
      bannedAt: null,
      OR: [
        { name: { contains: identifier, mode: "insensitive" } },
        { email: { contains: identifier, mode: "insensitive" } },
        { id: { contains: identifier } },
      ],
    },
    take: 20,
    select: { id: true, name: true, email: true, role: true },
  });
  if (users.length === 0) {
    return "系统中没有任何用户匹配。";
  }
  return users
    .map((u) => `- ${u.name}（${u.email}，ID: ${u.id}，角色: ${u.role ?? "未知"}）`)
    .join("\n");
}

const inputSchema = z.object({
  type: z.enum(["ticket", "project", "user", "commit", "weekly_report"]),
  id: z.string().optional().describe("工单号(如 #10156 或 10156)、项目ID、用户ID、commit SHA 等"),
  filters: z
    .object({
      status: z.string().optional().describe("ticket: DEVELOPING/READY_FOR_TEST/DONE/CLOSED 等"),
      priority: z.number().optional().describe("ticket: 1-4，数字越小优先级越高"),
      userId: z.string().optional().describe("用户标识（用户名、邮箱前缀、邮箱全称、cUID 等任意子串都会模糊匹配）"),
      projectId: z.string().optional().describe("项目ID"),
      ticketNo: z.number().int().optional().describe("commit: 按工单号过滤（关联 TicketCommit.ticketNo）"),
      activityWindow: z
        .enum(["today", "yesterday", "this_week", "this_month", "recent"])
        .optional()
        .describe("user: 工作近况时间范围；today/昨日/本周/本月/最近"),
    })
    .optional(),
  limit: z.number().min(1).max(20).default(5),
});

type Input = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Query functions — each returns a human-readable summary string
// ---------------------------------------------------------------------------

async function queryTicket(id: string | undefined, filters: Input["filters"], viewerUserId?: string): Promise<StructuredResult> {
  const idStr = id?.replace(/^#/, "").trim();
  const isNumeric = /^\d+$/.test(idStr ?? "");

  if (idStr) {
    const ticket = await prisma.ticket.findUnique({
      where: isNumeric ? { ticketNo: parseInt(idStr) } : { id: idStr },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        priority: true,
        deadline: true,
        createdAt: true,
        creator: { select: { name: true } },
        assignees: {
          include: { user: { select: { name: true, email: true } } },
        },
        project: { select: { id: true, name: true } },
        module: { select: { name: true } },
      },
    });
    if (ticket) {
      const assigneeNames = ticket.assignees.map((a) => a.user.name || a.user.email).join("、");
      const deadlineStr = ticket.deadline
        ? `，截止 ${new Date(ticket.deadline).toLocaleDateString("zh-CN")}`
        : "";
      // 该工单的提交记录（按时间倒序，最新 5 条）。从 TicketCommit 反查，
      // 不依赖语义搜索对数字工单 ID 的命中率（向量嵌入对纯数字 ID 区分度差）。
      const commits = await prisma.ticketCommit.findMany({
        where: { ticketNo: ticket.ticketNo },
        orderBy: { committedAt: "desc" },
        take: 5,
        select: {
          id: true,
          commitSha: true,
          subject: true,
          author: true,
          committedAt: true,
          branches: true,
        },
      });

      const summaryLines = [
        `工单 #${ticket.ticketNo} ${ticket.title}`,
        `状态：${ticket.status}，优先级：${ticket.priority}（1最高）`,
        `项目：${ticket.project.name} / ${ticket.module.name}`,
        `指派给：${assigneeNames || "无人"}`,
        `创建者：${ticket.creator.name}${deadlineStr}`,
        `创建时间：${new Date(ticket.createdAt).toLocaleString("zh-CN")}`,
      ];

      const sources: SourceReference[] = [{
        index: 1,
        title: `#${ticket.ticketNo} ${ticket.title}`,
        url: `/tickets/${ticket.id}`,
        type: "ticket" as const,
      }];

      if (commits.length > 0) {
        summaryLines.push("");
        summaryLines.push(`最新提交（共 ${commits.length} 条）：`);
        commits.forEach((c) => {
          summaryLines.push(
            `${c.commitSha.slice(0, 7)} ${c.subject} | ${c.author} | ${new Date(c.committedAt).toLocaleString("zh-CN")} | 分支 ${c.branches.join(", ") || "无"}`,
          );
        });
        commits.forEach((c, idx) => {
          sources.push({
            index: idx + 2,
            title: `${c.commitSha.slice(0, 7)} ${c.subject}`,
            url: `/tickets/${ticket.id}`,
            type: "commit" as const,
          });
        });
      } else {
        summaryLines.push("");
        summaryLines.push("该工单暂无关联提交记录。");
      }

      return {
        summary: summaryLines.join("\n"),
        sources,
      };
    }
    return {
      summary: `未找到工单 #${idStr}`,
      sources: []
    };
  }

  // Filter-based list
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.priority) where.priority = filters.priority;
  if (filters?.projectId) where.projectId = filters.projectId;
  if (filters?.userId) {
    where.assignees = { some: { userId: filters.userId } };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { ticketNo: "desc" },
    take: 20,
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      priority: true,
      deadline: true,
      project: { select: { name: true } },
    },
  });

  if (tickets.length === 0) return { summary: "没有找到符合条件的工单", sources: [] };

  const lines = [`找到 ${tickets.length} 个工单（显示前 ${Math.min(tickets.length, 20)} 个）：`];
  const sources: SourceReference[] = [];
  for (let i = 0; i < Math.min(tickets.length, 10); i++) {
    const t = tickets[i];
    const deadline = t.deadline ? ` ⏰${new Date(t.deadline).toLocaleDateString("zh-CN")}` : "";
    lines.push(`#${t.ticketNo} ${t.title} | ${t.status} | P${t.priority} | ${t.project.name}${deadline} → /tickets/${t.id}`);
    sources.push({
      index: i + 1,
      title: `#${t.ticketNo} ${t.title}`,
      url: `/tickets/${t.id}`,
      type: "ticket" as const
    });
  }
  if (tickets.length > 10) lines.push(`…还有 ${tickets.length - 10} 个`);
  return { summary: lines.join("\n"), sources };
}

async function queryProject(id: string | undefined, filters: Input["filters"], viewerUserId?: string): Promise<StructuredResult> {
  if (!id) {
    // List active projects
    const projects = await prisma.project.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      take: 20,
      select: { id: true, name: true },
    });
    if (projects.length === 0) return { summary: "当前没有活跃项目", sources: [] };
    const sources: SourceReference[] = projects.map((p, i) => ({
      index: i + 1,
      title: p.name,
      url: `/projects/${p.id}`,
      type: "project" as const
    }));
    return {
      summary: `当前活跃项目：\n${projects.map((p) => `• ${p.name} → /projects/${p.id}`).join("\n")}`,
      sources
    };
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      owner: { select: { name: true } },
      responsibilities: {
        orderBy: { kind: "asc" },
        include: {
          modules: {
            orderBy: { name: "asc" },
            include: {
              tickets: {
                select: { status: true, priority: true, deadline: true, ticketNo: true, title: true, id: true },
              },
            },
          },
        },
      },
    },
  });

  if (!project) return { summary: `未找到项目 ID: ${id}`, sources: [] };

  let total = 0;
  let done = 0;
  let overdue = 0;
  const now = new Date();

  for (const resp of project.responsibilities) {
    for (const mod of resp.modules) {
      for (const t of mod.tickets) {
        total++;
        if (t.status === "DONE" || t.status === "CLOSED") done++;
        if (t.deadline && new Date(t.deadline) < now && t.status !== "DONE" && t.status !== "CLOSED") {
          overdue++;
        }
      }
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const inProgress = total - done;

  return {
    summary: `项目：${project.name}
负责人：${project.owner?.name ?? "未知"}
状态：${project.status}
进度：${done}/${total} 完成（${pct}%）| 进行中 ${inProgress} | 逾期 ${overdue} 个
链接：/projects/${project.id}`,
    sources: [{
      index: 1,
      title: project.name,
      url: `/projects/${project.id}`,
      type: "project" as const
    }]
  };
}

async function queryUser(
  id: string | undefined,
  filters: Input["filters"],
  viewerUserId?: string
): Promise<StructuredResult> {
  const targetId = filters?.userId ?? id;
  const resolved = await resolveUser(targetId, viewerUserId);
  console.log(`[queryUser] targetId="${targetId}" resolved=${resolved ? JSON.stringify(resolved) : "null"} window=${filters?.activityWindow ?? "none"}`);

  if (!resolved) {
    const hint = targetId
      ? `候选用户列表（按"姓名（邮箱，ID，角色）"）：\n${await listCandidateUsers(targetId)}`
      : "请在 filters.userId 或 id 中提供用户名/邮箱/用户ID。";
    return {
      summary: `未找到用户：${targetId ?? "(未指定)"}\n${hint}`,
      sources: []
    };
  }

  // 按 activityWindow 算出时间窗口下界（包含）。undefined = 不过滤。
  const windowSince = getWindowStart(filters?.activityWindow);
  const dateFilter = windowSince ? { gte: windowSince } : undefined;

  const [user, assignedCount, createdCount, reportCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: resolved.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.ticketAssignee.count({
      where: { userId: resolved.id },
    }),
    prisma.ticket.count({
      where: { creatorId: resolved.id },
    }),
    prisma.weeklyReport.count({
      where: { userId: resolved.id },
    }),
  ]);

  if (!user) return { summary: `未找到用户 ID: ${resolved.id}`, sources: [] };

  // ---- 当前负责范围内、窗口中被更新过的工单 ----
  // Ticket.updatedAt 只能证明工单被某人修改过。目标用户作为 assignee / creator
  // 仅表示关联关系，不能据此断言更新由目标用户完成，更不能当作个人产出。
  const relatedTickets = dateFilter
    ? await prisma.ticket.findMany({
        where: {
          updatedAt: dateFilter,
          OR: [
            { assignees: { some: { userId: resolved.id } } },
            { creatorId: resolved.id },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          updatedAt: true,
          project: { select: { name: true } },
          creator: { select: { name: true } }
        },
      })
    : await prisma.ticket.findMany({
        where: {
          OR: [
            { assignees: { some: { userId: resolved.id } } },
            { creatorId: resolved.id },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          updatedAt: true,
          project: { select: { name: true } },
          creator: { select: { name: true } }
        },
      });

  // ---- 负责范围内工单的 commit ----
  // TicketCommit 目前只有 author 文本，没有可靠的 userId 映射。因此这些 commit
  // 只能作为“相关工单有代码变更”的证据，绝不能表述成目标用户本人提交。
  const relatedCommits = dateFilter
    ? await prisma.ticketCommit.findMany({
        where: {
          committedAt: dateFilter,
          ticket: {
            OR: [
              { assignees: { some: { userId: resolved.id } } },
              { creatorId: resolved.id },
            ],
          },
        },
        orderBy: { committedAt: "desc" },
        take: 20,
        select: {
          commitSha: true,
          subject: true,
          author: true,
          committedAt: true,
          ticketNo: true,
          ticket: {
            select: {
              id: true,
              ticketNo: true,
              title: true,
              status: true,
              project: { select: { name: true } },
            },
          },
        },
      })
    : await prisma.ticketCommit.findMany({
        where: {
          ticket: {
            OR: [
              { assignees: { some: { userId: resolved.id } } },
              { creatorId: resolved.id },
            ],
          },
        },
        orderBy: { committedAt: "desc" },
        take: 20,
        select: {
          commitSha: true,
          subject: true,
          author: true,
          committedAt: true,
          ticketNo: true,
          ticket: {
            select: {
              id: true,
              ticketNo: true,
              title: true,
              status: true,
              project: { select: { name: true } },
            },
          },
        },
      });

  // ---- 窗口内笔记 ----
  const recentNotes = dateFilter
    ? await prisma.pkmNote.findMany({
        where: { userId: resolved.id, updatedAt: dateFilter },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          project: { select: { name: true } },
        },
      })
    : await prisma.pkmNote.findMany({
        where: { userId: resolved.id },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          project: { select: { name: true } },
        },
      });

  // ---- 相关工单补集 ----
  // Ticket.updatedAt 不会因为 commit 写入而自动更新，因此把窗口内有 commit 的相关工单
  // 并入“负责范围”。这仍然只是工单级活动，不能归因给目标用户。
  type RecentTicket = {
    id: string;
    ticketNo: number;
    title: string;
    status: string;
    updatedAt: Date;
    project: { name: string };
    creator?: { name: string | null } | null;
  };
  const mergedMap = new Map<string, RecentTicket>();
  for (const t of relatedTickets) mergedMap.set(t.id, t);
  for (const c of relatedCommits) {
    if (!c.ticket) continue;
    const existing = mergedMap.get(c.ticket.id);
    const committedAt = new Date(c.committedAt);
    if (!existing) {
      mergedMap.set(c.ticket.id, {
        id: c.ticket.id,
        ticketNo: c.ticket.ticketNo,
        title: c.ticket.title,
        status: c.ticket.status,
        updatedAt: committedAt,
        project: c.ticket.project ?? { name: "未分类" },
      });
    } else if (committedAt.getTime() > existing.updatedAt.getTime()) {
      mergedMap.set(c.ticket.id, { ...existing, updatedAt: committedAt });
    }
  }
  const mergedRecentTickets = Array.from(mergedMap.values())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 10);

  const sources: SourceReference[] = mergedRecentTickets.map((t, i) => ({
    index: i + 1,
    title: `#${t.ticketNo} ${t.title}`,
    url: `/tickets/${t.id}`,
    type: "ticket" as const
  }));

  const windowLabel = formatWindowLabel(filters?.activityWindow);
  const lines = [`用户：${user.name}（${user.email}）`];
  lines.push(`角色：${user.role} | 在职时长：${Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30))} 个月`);
  lines.push(`指派工单：${assignedCount} 个 | 创建工单：${createdCount} 个 | 周报：${reportCount} 份`);

  if (windowLabel) lines.push(`时间窗口：${windowLabel}`);

  const evidenceWindow = windowLabel ?? "当前查询范围";
  const hasDirectActivityEvidence = recentNotes.length > 0;
  lines.push(
    `\n【归因结论】${evidenceWindow}内${
      hasDirectActivityEvidence
        ? "存在该用户本人更新的笔记；除此之外，没有可可靠归因给该用户的工单操作或代码提交证据。"
        : "没有可可靠归因给该用户本人的工单操作、代码提交或笔记更新证据。"
    }`,
  );

  if (mergedRecentTickets.length > 0) {
    lines.push(
      `\n【仅表示负责关系，禁止当作个人产出】${evidenceWindow}内被更新的相关工单（目标用户是 assignee 或 creator，但更新者身份未知）：`,
    );
    for (const t of mergedRecentTickets) {
      const updated = new Date(t.updatedAt).toLocaleString("zh-CN");
      const creatorTag = t.creator?.name ? ` | 创建者:${t.creator.name}` : "";
      lines.push(
        `#${t.ticketNo} ${t.title} | ${t.status} | ${t.project.name}${creatorTag} | 工单更新时间 ${updated} | 归因=未知 → /tickets/${t.id}`,
      );
    }
  } else {
    lines.push(`\n${evidenceWindow}内没有被更新的相关工单。`);
  }

  if (relatedCommits.length > 0) {
    lines.push(
      `\n【仅表示相关工单有代码变更，禁止归因给目标用户】${evidenceWindow}内相关工单的提交：`,
    );
    for (const c of relatedCommits) {
      const committedAt = new Date(c.committedAt).toLocaleString("zh-CN");
      const ticketRef = c.ticket
        ? `#${c.ticket.ticketNo} ${c.ticket.title}`
        : `#${c.ticketNo}`;
      const url = c.ticket ? `/tickets/${c.ticket.id}` : `/tickets`;
      lines.push(
        `${c.commitSha.slice(0, 7)} ${c.subject} | git author 原文: ${c.author} | ${committedAt} | ${ticketRef} | 目标用户归因=未验证 → ${url}`,
      );
    }
  } else {
    lines.push(`\n${evidenceWindow}内相关工单没有代码提交记录。`);
  }

  if (recentNotes.length > 0) {
    lines.push(`\n${windowLabel ? windowLabel + "内" : "最近"}更新的笔记：`);
    for (const n of recentNotes) {
      const updated = new Date(n.updatedAt).toLocaleString("zh-CN");
      const projectTag = n.project?.name ? ` | 项目: ${n.project.name}` : "";
      lines.push(`《${n.title}》${projectTag} | 更新 ${updated} → /notes/${n.id}`);
    }
  }

  return {
    summary: lines.join("\n"),
    sources,
    attribution: {
      kind: "user_activity",
      targetUserName: user.name ?? user.email,
      windowLabel: evidenceWindow,
      hasDirectEvidence: hasDirectActivityEvidence,
      directNoteCount: recentNotes.length,
      relatedTicketCount: mergedRecentTickets.length,
      relatedCommitCount: relatedCommits.length,
    },
  };
}

/**
 * Map activityWindow enum to the inclusive lower bound of the time window.
 * Returns undefined to disable filtering.
 */
function getWindowStart(window: Input["filters"] extends infer F ? (F extends { activityWindow?: infer W } ? W : undefined) : undefined): Date | undefined {
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
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    default:
      return undefined;
  }
}

function formatWindowLabel(window: Input["filters"] extends infer F ? (F extends { activityWindow?: infer W } ? W : undefined) : undefined): string | null {
  if (!window) return null;
  const labels: Record<string, string> = {
    today: "今天",
    yesterday: "昨天",
    this_week: "本周",
    this_month: "本月",
    recent: "最近 7 天",
  };
  return labels[window] ?? null;
}

async function queryCommit(id: string | undefined, filters: Input["filters"], viewerUserId?: string): Promise<StructuredResult> {
  // 按工单号过滤：这是“某工单的最新提交记录”类查询的精确入口，
  // 不依赖向量搜索（语义检索对纯数字 ID 区分度差）。
  if (filters?.ticketNo !== undefined) {
    const ticketNo = filters.ticketNo;
    const ticket = await prisma.ticket.findUnique({
      where: { ticketNo },
      select: { id: true, ticketNo: true, title: true, status: true },
    });
    if (!ticket) return { summary: `未找到工单 #${ticketNo}`, sources: [] };

    const commits = await prisma.ticketCommit.findMany({
      where: { ticketNo },
      orderBy: { committedAt: "desc" },
      take: 5,
      select: {
        commitSha: true,
        subject: true,
        author: true,
        committedAt: true,
        branches: true,
      },
    });

    if (commits.length === 0) {
      return { summary: `工单 #${ticket.ticketNo} ${ticket.title} 暂无关联提交记录。`, sources: [] };
    }

    const lines = [`工单 #${ticket.ticketNo} ${ticket.title}（${ticket.status}）的最新提交（共 ${commits.length} 条）：`];
    const sources: SourceReference[] = commits.map((c, i) => ({
      index: i + 1,
      title: `${c.commitSha.slice(0, 7)} ${c.subject}`,
      url: `/tickets/${ticket.id}`,
      type: "commit" as const,
    }));
    for (const c of commits) {
      lines.push(
        `${c.commitSha.slice(0, 7)} ${c.subject} | ${c.author} | ${new Date(c.committedAt).toLocaleString("zh-CN")} | 分支 ${c.branches.join(", ") || "无"}`,
      );
    }
    return { summary: lines.join("\n"), sources };
  }

  if (!id) return { summary: "请提供 commit SHA（如 abc1234）或使用 filters.ticketNo 指定工单号", sources: [] };

  const commit = await prisma.ticketCommit.findFirst({
    where: { commitSha: { startsWith: id } },
    orderBy: { committedAt: "desc" },
    include: {
      ticket: {
        select: { id: true, ticketNo: true, title: true, status: true, project: { select: { name: true } } },
      },
    },
  });

  if (!commit) return { summary: `未找到 commit: ${id}`, sources: [] };

  return {
    summary: `Commit ${commit.commitSha.slice(0, 7)}
消息：${commit.subject}
作者：${commit.author}
时间：${new Date(commit.committedAt).toLocaleString("zh-CN")}
分支：${commit.branches.join(", ") || "无"}
关联工单：#${commit.ticket.ticketNo} ${commit.ticket.title}（${commit.ticket.status}）→ /tickets/${commit.ticket.id}`,
    sources: [{
      index: 1,
      title: `${commit.commitSha.slice(0, 7)} ${commit.subject}`,
      url: `/tickets/${commit.ticket.id}`,
      type: "commit" as const
    }]
  };
}

async function queryWeeklyReport(
  id: string | undefined,
  filters: Input["filters"],
  viewerUserId?: string
): Promise<StructuredResult> {
  // Try to resolve user from filters.userId or id
  const targetId = filters?.userId ?? id;
  const resolved = targetId ? await resolveUser(targetId, viewerUserId) : null;

  console.log(`[queryWeeklyReport] targetId="${targetId}" resolved=${resolved ? JSON.stringify(resolved) : "null"}`);

  if (resolved) {
    const reports = await prisma.weeklyReport.findMany({
      where: { userId: resolved.id },
      orderBy: { weekStart: "desc" },
      take: 5,
      include: { projects: { include: { project: { select: { name: true } } } } },
    });

    if (reports.length === 0) return { summary: `${resolved.name} 暂无周报记录`, sources: [] };

    const lines = [`${resolved.name} 的周报（最近 ${reports.length} 份）：`];
    const sources: SourceReference[] = reports.map((r, i) => {
      const projectNames = r.projects.map((p) => p.project.name).join("、") || "无项目";
      lines.push(`${r.title}（${r.weekStart} ~ ${r.weekEnd}）| ${projectNames} → /weekly-reports/${r.id}`);
      return {
        index: i + 1,
        title: r.title,
        url: `/weekly-reports/${r.id}`,
        type: "weekly_report" as const
      };
    });
    return { summary: lines.join("\n"), sources };
  }

  // Try by report ID
  if (id && !resolved) {
    const report = await prisma.weeklyReport.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
        projects: { include: { project: { select: { name: true } } } },
      },
    });

    if (report) {
      const projectNames = report.projects.map((p) => p.project.name).join("、") || "无项目";
      const summary = report.aiSummary ? `\nAI 摘要：${report.aiSummary}` : "";
      return {
        summary: `${report.title}
用户：${report.user.name}（${report.user.email}）
周期：${report.weekStart} ~ ${report.weekEnd}
项目：${projectNames}${summary}
链接：/weekly-reports/${report.id}`,
        sources: [{
          index: 1,
          title: report.title,
          url: `/weekly-reports/${report.id}`,
          type: "weekly_report" as const
        }]
      };
    }
  }

  return { summary: `未找到周报：${id ?? "(未指定)"}`, sources: [] };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const searchStructured = tool({
  description:
    `【精确查询 - 快速浅查工具】
定位：分层查询的第一步（浅查），用于快速获取基础信息

适用场景：
- 精确 ID 查询：工单号（#10156）、项目 ID、用户 ID、commit SHA
- 进度统计：完成率、逾期数、进行中统计
- 列表查询：所有活跃项目、用户工单列表、周报列表
- 过滤查询：按 status/priority/userId/projectId 过滤

支持的查询类型（必须指定 type）：
- type=ticket：工单查询，支持 id（工单号或 ID）和 filters 过滤
- type=project：项目查询，支持 id（项目 ID），无 id 时列出所有活跃项目
- type=user：用户查询，支持 id 或 filters.userId（支持中文姓名模糊匹配）
- type=commit：提交查询，支持 id（commit SHA 前缀）
- type=weekly_report：周报查询，支持 id 或 filters.userId

【不擅长 - 请用 searchKnowledge】：
- 语义模糊的查询（"关于 X 的讨论"、"最近相关的笔记"）→ 用 searchKnowledge
- 需要理解文档内容的综合搜索 → 用 searchKnowledge
- 需要附件内容、讨论上下文 → 用 searchKnowledge`,
  inputSchema,
  execute: async ({ type, id, filters, limit: _limit }) => {
    const viewerUserId = currentViewerUserId ?? undefined;
    console.log(`[searchStructured] type=${type} id=${id} filters=${JSON.stringify(filters)} viewer=${viewerUserId}`);
    try {
      let result: StructuredResult;
      switch (type) {
        case "ticket":
          result = await queryTicket(id, filters, viewerUserId);
          break;
        case "project":
          result = await queryProject(id, filters, viewerUserId);
          break;
        case "user":
          result = await queryUser(id, filters, viewerUserId);
          break;
        case "commit":
          result = await queryCommit(id, filters, viewerUserId);
          break;
        case "weekly_report":
          result = await queryWeeklyReport(id, filters, viewerUserId);
          break;
        default:
          result = { summary: `不支持的查询类型: ${type}`, sources: [] };
      }
      console.log(`[searchStructured] type=${type} result summary len=${result.summary.length} sources count=${result.sources.length}`);
      return {
        summary: result.summary,
        sources: result.sources,
        ...(result.attribution ? { attribution: result.attribution } : {}),
        _debug: "structured_with_sources"
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[searchStructured] error:", msg);
      return {
        summary: `查询失败: ${msg}`,
        sources: [],
        _debug: "structured_with_sources"
      };
    }
  },
});
