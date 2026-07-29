/**
 * Commit query for search-structured.
 */

import { prisma } from "@/shared/db/client";
import type { StructuredResult, SourceReference, ExtractedUser } from "@/features/ai/types/structured";
import { DISAMBIGUATION_THRESHOLDS } from "@/features/ai/types/structured";
import { resolveUser } from "@/features/ai/core/resolvers/user-resolver";
import { getWindowStart, formatWindowLabel } from "@/features/ai/core/formatters";

export interface CommitQueryInput {
  id?: string;
  filters?: {
    ticketNo?: number;
    userId?: string;
    activityWindow?: "today" | "yesterday" | "this_week" | "this_month" | "recent";
    extractedUser?: ExtractedUser;
  };
  limit?: number;
}

/**
 * Execute a commit query.
 * Supports filtering by ticket number, user, or specific commit SHA.
 */
export async function queryCommit(input: CommitQueryInput, viewerUserId?: string): Promise<StructuredResult> {
  const { id, filters } = input;

  // 按工单号过滤：这是"某工单的最新提交记录"类查询的精确入口，
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

  // 按用户过滤 + 时间窗口 — "刘工最近提交了什么"
  const extractedUser = filters?.extractedUser;
  if (extractedUser) {
    const resolved = await resolveUser(extractedUser, viewerUserId);

    if (resolved?.candidates && resolved.candidates.length > 0) {
      const userCandidates = resolved.candidates.map((u) => ({
        id: u.id,
        label: `${u.name ?? u.id}（${u.email}）`,
        summary: "",
      }));
      return {
        summary: `找到多个与"${extractedUser.raw}"相关的用户，请确认目标用户：\n${
          resolved.candidates.map((u, i) => `${i + 1}. ${u.name}（${u.email}）`).join("\n")
        }\n\n请输入数字或姓名确认。`,
        sources: [],
        attribution: {
          kind: "disambiguation" as const,
          entityType: "user" as const,
          candidates: userCandidates,
          count: resolved.candidates.length,
        },
        decision: {
          type: "human" as const,
          reason: `找到 ${resolved.candidates.length} 个匹配用户，需要人工确认`,
          entityType: "user",
          candidates: userCandidates,
        },
      };
    }

    if (!resolved?.user) {
      return { summary: `未找到用户：${extractedUser.raw}`, sources: [] };
    }

    const userName = resolved.user.name ?? "";
    const windowStart = getWindowStart(filters?.activityWindow);
    const windowLabel = formatWindowLabel(filters?.activityWindow);

    const where: Record<string, unknown> = {
      author: { contains: userName },
      ...(windowStart ? { committedAt: { gte: windowStart } } : {}),
    };

    const commits = await prisma.ticketCommit.findMany({
      where,
      orderBy: { committedAt: "desc" },
      take: 10,
      select: {
        id: true,
        ticketNo: true,
        commitSha: true,
        subject: true,
        author: true,
        committedAt: true,
        branches: true,
      },
    });

    if (commits.length === 0) {
      const prefix = windowLabel && windowLabel !== "最近" ? `在「${windowLabel}」内 ` : (windowLabel ? `${windowLabel}内 ` : "");
      return {
        summary: `${prefix}${resolved.user.name} 暂无提交记录。`,
        sources: [],
      };
    }

    // >= 5 条时触发 HIL
    if (commits.length >= DISAMBIGUATION_THRESHOLDS.commit) {
      const commitCandidates = commits.map((c) => ({
        id: c.id,
        label: `${c.commitSha.slice(0, 7)} ${c.subject}（${new Date(c.committedAt).toLocaleDateString("zh-CN")}）`,
        summary: `${c.author} | 分支 ${c.branches.join(", ") || "无"}`,
      }));
      return {
        summary: `找到 ${resolved.user.name}${windowLabel ? ` ${windowLabel}内 ` : " "}${commits.length} 条提交，请选择：`,
        sources: [],
        attribution: {
          kind: "disambiguation" as const,
          entityType: "commit" as const,
          candidates: commitCandidates,
          count: commits.length,
        },
        decision: {
          type: "human" as const,
          reason: `找到 ${commits.length} 条提交，需要人工选择`,
          entityType: "commit",
          candidates: commitCandidates,
        },
      };
    }

    const lines = [`${resolved.user.name}${windowLabel ? ` ${windowLabel}` : ""} 的提交（共 ${commits.length} 条）：`];
    const sources: SourceReference[] = commits.map((c, i) => ({
      index: i + 1,
      title: `${c.commitSha.slice(0, 7)} ${c.subject}`,
      url: `/tickets`,
      type: "commit" as const,
    }));
    for (const c of commits) {
      lines.push(
        `${c.commitSha.slice(0, 7)} ${c.subject} | ${c.author} | ${new Date(c.committedAt).toLocaleString("zh-CN")} | #${c.ticketNo} | 分支 ${c.branches.join(", ") || "无"}`,
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
