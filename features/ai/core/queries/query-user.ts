/**
 * User query for search-structured.
 */

import { prisma } from "@/shared/db/client";
import type {
  StructuredResult,
  SourceReference,
  ExtractedUser,
} from "@/features/ai/types/structured";
import { resolveUser } from "@/features/ai/core/resolvers/user-resolver";
import { getWindowStart, formatWindowLabel } from "@/features/ai/core/formatters";

export interface UserQueryInput {
  id?: string;
  filters?: {
    userId?: string;
    activityWindow?: "today" | "yesterday" | "this_week" | "this_month" | "recent";
    extractedUser?: ExtractedUser;
  };
  limit?: number;
}

/**
 * Execute a user query.
 * Resolves user identifier and retrieves user activity information.
 */
export async function queryUser(
  input: UserQueryInput,
  viewerUserId?: string
): Promise<StructuredResult> {
  const { filters, id } = input;
  // 优先使用 extractedUser（包含 raw + normalized），其次使用 userId
  const extractedUser = filters?.extractedUser;
  const targetId = filters?.userId ?? id;

  // 构建 resolveUser 需要的 identifier
  const identifier = extractedUser ?? (targetId ? { raw: targetId, normalized: targetId } : undefined);
  const resolved = await resolveUser(identifier, viewerUserId);

  console.log(`[queryUser] extractedUser=${extractedUser ? JSON.stringify(extractedUser) : "none"} resolved=${JSON.stringify(resolved)} window=${filters?.activityWindow ?? "none"}`);

  // 处理无匹配或弱匹配多候选情况
  if (!resolved.user) {
    const candidates = resolved.candidates ?? [];
    const queryText = extractedUser?.raw ?? targetId ?? "(未指定)";

    if (candidates.length > 0) {
      return {
        summary: `找到 ${candidates.length} 个与"${queryText}"相关的匹配，请确认目标：\n${
          candidates.map((u, i) => `${i + 1}. ${u.name}（${u.email}）`).join("\n")
        }\n\n请输入数字或姓名确认。`,
        sources: [],
        attribution: {
          kind: "disambiguation" as const,
          entityType: "user" as const,
          candidates: candidates.map((u) => ({
            id: u.id,
            label: `${u.name}（${u.email}）`,
            summary: "",
          })),
          count: candidates.length,
        },
        decision: {
          type: "human" as const,
          reason: `找到 ${candidates.length} 个相关匹配，需要人工确认`,
          entityType: "user",
          candidates: candidates.map((u) => ({
            id: u.id,
            label: `${u.name}（${u.email}）`,
            summary: "",
          })),
        },
      };
    }

    return {
      summary: `未找到用户：${queryText}`,
      sources: [],
    };
  }

  // 按 activityWindow 算出时间窗口下界（包含）。undefined = 不过滤。
  const windowSince = getWindowStart(filters?.activityWindow);
  const dateFilter = windowSince ? { gte: windowSince } : undefined;

  const [user, assignedCount, createdCount, reportCount, userProfile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: resolved.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.ticketAssignee.count({
      where: { userId: resolved.user.id },
    }),
    prisma.ticket.count({
      where: { creatorId: resolved.user.id },
    }),
    prisma.weeklyReport.count({
      where: { userId: resolved.user.id },
    }),
    // 查询用户画像（用于展示专长、兴趣等）
    prisma.aiUserProfile.findUnique({
      where: { userId: resolved.user.id },
      select: {
        profile: true,
        updatedAt: true,
        sourceSummaryCount: true,
      },
    }),
  ]);

  if (!user) return { summary: `未找到用户 ID: ${resolved.user.id}`, sources: [] };

  // 当前负责范围内、窗口中被更新过的工单
  const relatedTickets = dateFilter
    ? await prisma.ticket.findMany({
        where: {
          updatedAt: dateFilter,
          OR: [
            { assignees: { some: { userId: resolved.user.id } } },
            { creatorId: resolved.user.id },
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
            { assignees: { some: { userId: resolved.user.id } } },
            { creatorId: resolved.user.id },
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

  // 负责范围内工单的 commit
  const relatedCommits = dateFilter
    ? await prisma.ticketCommit.findMany({
        where: {
          committedAt: dateFilter,
          ticket: {
            OR: [
              { assignees: { some: { userId: resolved.user.id } } },
              { creatorId: resolved.user.id },
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
              { assignees: { some: { userId: resolved.user.id } } },
              { creatorId: resolved.user.id },
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

  // 窗口内笔记
  const recentNotes = dateFilter
    ? await prisma.pkmNote.findMany({
        where: { userId: resolved.user.id, updatedAt: dateFilter },
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
        where: { userId: resolved.user.id },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          project: { select: { name: true } },
        },
      });

  // 周报不限制时间窗口（只要有就返回），但工单更新按 dateFilter
  const [userReports, directStatusChanges, directAssigneeChanges, directComments] = await Promise.all([
    // 周报：最近 5 份，不限时间窗口
    prisma.weeklyReport.findMany({
      where: { userId: resolved.user.id },
      orderBy: { weekStart: "desc" },
      take: 5,
      include: {
        projects: { include: { project: { select: { name: true } } } },
      },
    }),
    // 可可靠归因给本人的工单操作（按 dateFilter）
    prisma.ticketStatusHistory.findMany({
      where: { changedById: resolved.user.id, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        createdAt: true,
        status: true,
        ticket: { select: { id: true, ticketNo: true, title: true } },
      },
    }),
    prisma.ticketAssigneeHistory.findMany({
      where: { changedById: resolved.user.id, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        createdAt: true,
        ticket: { select: { id: true, ticketNo: true, title: true } },
      },
    }),
    prisma.ticketComment.findMany({
      where: { authorId: resolved.user.id, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        createdAt: true,
        content: true,
        ticket: { select: { id: true, ticketNo: true, title: true } },
      },
    }),
  ]);

  // 合并工单和 commit 的更新，构建综合活动时间线
  // Commits 单独展示（按 commit 时间排序）
  const recentCommitsSummary = relatedCommits.length > 0
    ? relatedCommits.slice(0, 10).map((c) => ({
        sha: c.commitSha.slice(0, 7),
        subject: c.subject,
        author: c.author,
        committedAt: c.committedAt,
        ticketNo: c.ticketNo,
      }))
    : [];
  // 相关工单补集（合并 ticket updatedAt 和 commit committedAt）
  type RecentTicket = {
    id: string;
    ticketNo: number;
    title: string;
    status: string;
    updatedAt: Date;
    project: { name: string };
  };
  const mergedTicketMap = new Map<string, RecentTicket>();
  for (const t of relatedTickets) mergedTicketMap.set(t.id, t);
  for (const c of relatedCommits) {
    if (!c.ticket) continue;
    const existing = mergedTicketMap.get(c.ticket.id);
    const committedAt = new Date(c.committedAt);
    if (!existing) {
      mergedTicketMap.set(c.ticket.id, {
        id: c.ticket.id,
        ticketNo: c.ticket.ticketNo,
        title: c.ticket.title,
        status: c.ticket.status,
        updatedAt: committedAt,
        project: c.ticket.project ?? { name: "未分类" },
      });
    } else if (committedAt.getTime() > existing.updatedAt.getTime()) {
      mergedTicketMap.set(c.ticket.id, { ...existing, updatedAt: committedAt });
    }
  }
  const mergedRecentTickets = Array.from(mergedTicketMap.values())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 20);

  const directEvidenceCount = recentNotes.length + directStatusChanges.length + directAssigneeChanges.length + directComments.length;
  const hasDirectActivityEvidence = directEvidenceCount > 0;
  const directTicketIds = new Set([
    ...directStatusChanges.map((item) => item.ticket.id),
    ...directAssigneeChanges.map((item) => item.ticket.id),
    ...directComments.map((item) => item.ticket.id),
  ]);
  const sources: SourceReference[] = [
    ...recentNotes.map((n, i) => ({
      index: i + 1,
      title: n.title,
      url: `/notes/${n.id}`,
      type: "user" as const,
    })),
    ...userReports.map((r, i) => ({
      index: recentNotes.length + i + 1,
      title: r.title,
      url: `/reports/weekly-reports/${r.id}`,
      type: "weekly_report" as const,
    })),
    ...Array.from(directTicketIds).map((id, i) => {
      const ticket = [...directStatusChanges, ...directAssigneeChanges, ...directComments]
        .find((item) => item.ticket.id === id)?.ticket;
      return {
        index: recentNotes.length + userReports.length + i + 1,
        title: ticket ? `#${ticket.ticketNo} ${ticket.title}` : id,
        url: `/tickets/${id}`,
        type: "ticket" as const,
      };
    }),
  ];

  const windowLabel = formatWindowLabel(filters?.activityWindow);
  const lines = [`用户：${user.name}（${user.email}）`];
  lines.push(`角色：${user.role} | 在职时长：${Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30))} 个月`);
  lines.push(`指派工单：${assignedCount} 个 | 创建工单：${createdCount} 个 | 周报：${reportCount} 份`);

  // 用户画像信息
  if (userProfile?.profile) {
    const profile = userProfile.profile as Record<string, unknown>;
    const profileParts: string[] = [];
    if (profile.expertise && Array.isArray(profile.expertise) && profile.expertise.length > 0) {
      profileParts.push(`专长：${(profile.expertise as string[]).join("、")}`);
    }
    if (profile.interests && Array.isArray(profile.interests) && profile.interests.length > 0) {
      profileParts.push(`兴趣：${(profile.interests as string[]).join("、")}`);
    }
    if (profile.recentTopics && Array.isArray(profile.recentTopics) && profile.recentTopics.length > 0) {
      profileParts.push(`近期话题：${(profile.recentTopics as string[]).join("、")}`);
    }
    if (profileParts.length > 0) {
      lines.push(`\n人物画像：${profileParts.join(" | ")}`);
    }
  }

  if (windowLabel) lines.push(`时间窗口：${windowLabel}`);

  const evidenceWindow = windowLabel ?? "当前查询范围";
  const hasAnyActivity = hasDirectActivityEvidence || userReports.length > 0 || mergedRecentTickets.length > 0 || recentCommitsSummary.length > 0;
  lines.push(
    hasAnyActivity
      ? `\n${evidenceWindow}内记录到 ${directEvidenceCount + userReports.length + mergedRecentTickets.length + recentCommitsSummary.length} 条本人活动：`
      : `\n${evidenceWindow}内暂无该用户本人的活动记录。`,
  );

  if (userReports.length > 0) {
    lines.push(`\n周报（最近 ${userReports.length} 份）：`);
    for (const r of userReports) {
      const projectNames = r.projects.map((p) => p.project.name).join("、") || "无项目";
      const summary = r.aiSummary ? `\n  AI 摘要：${r.aiSummary.slice(0, 200)}` : "";
      lines.push(`• ${r.title}｜${projectNames}${summary}`);
    }
  }

  // 本周项目更新（综合工单和提交）
  if (mergedRecentTickets.length > 0) {
    lines.push(`\n本周项目更新（${mergedRecentTickets.length} 项）：`);
    for (const t of mergedRecentTickets.slice(0, 15)) {
      const updated = new Date(t.updatedAt).toLocaleString("zh-CN");
      lines.push(`#${t.ticketNo} ${t.title} [${t.status}] | ${t.project.name} | ${updated}`);
    }
  }

  // 本周提交记录
  if (recentCommitsSummary.length > 0) {
    lines.push(`\n本周提交（${recentCommitsSummary.length} 次）：`);
    for (const c of recentCommitsSummary.slice(0, 10)) {
      const date = new Date(c.committedAt).toLocaleDateString("zh-CN");
      lines.push(`• ${c.sha} ${c.subject} | ${c.author} | ${date} | #${c.ticketNo}`);
    }
  }

  if (directStatusChanges.length > 0) {
    lines.push(`\n工单状态变更：`);
    for (const item of directStatusChanges) {
      lines.push(`本人将 #${item.ticket.ticketNo} ${item.ticket.title} 变更为 ${item.status} | ${new Date(item.createdAt).toLocaleString("zh-CN")}`);
    }
  }
  if (directAssigneeChanges.length > 0) {
    lines.push(`\n工单指派调整：`);
    for (const item of directAssigneeChanges) {
      lines.push(`本人修改了 #${item.ticket.ticketNo} ${item.ticket.title} 的指派关系 | ${new Date(item.createdAt).toLocaleString("zh-CN")}`);
    }
  }
  if (directComments.length > 0) {
    lines.push(`\n工单评论：`);
    for (const item of directComments) {
      lines.push(`本人在 #${item.ticket.ticketNo} ${item.ticket.title} 发表评论 | ${new Date(item.createdAt).toLocaleString("zh-CN")}：${item.content.slice(0, 120)}`);
    }
  }
  if (recentNotes.length > 0) {
    lines.push(`\n笔记更新：`);
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
      directEvidenceCount,
      directNoteCount: recentNotes.length,
      directTicketActionCount: directStatusChanges.length + directAssigneeChanges.length,
      directCommentCount: directComments.length,
      relatedTicketCount: mergedRecentTickets.length,
      relatedCommitCount: recentCommitsSummary.length,
      relatedReportCount: userReports.length,
    },
  };
}
