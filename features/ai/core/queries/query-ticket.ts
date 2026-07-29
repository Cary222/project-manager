/**
 * Ticket query for search-structured.
 */

import { prisma } from "@/shared/db/client";
import type {
  StructuredResult,
  SourceReference,
} from "@/features/ai/types/structured";
import { DISAMBIGUATION_THRESHOLDS } from "@/features/ai/types/structured";

export interface TicketQueryInput {
  id?: string;
  filters?: {
    status?: string;
    priority?: number;
    userId?: string;
    projectId?: string;
  };
  limit?: number;
}

/**
 * Execute a ticket query.
 * Handles both specific ticket lookups (by ticketNo or id) and filtered lists.
 */
export async function queryTicket(
  input: TicketQueryInput
): Promise<StructuredResult> {
  const { id, filters, limit: _limit } = input;
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

  // 多于阈值时触发 HIL，让用户选择具体工单
  if (tickets.length >= DISAMBIGUATION_THRESHOLDS.ticket) {
    const ticketCandidates = tickets.slice(0, 20).map((t) => ({
      id: t.id,
      label: `#${t.ticketNo} ${t.title}`,
      summary: `${t.status} | P${t.priority} | ${t.project.name}`,
    }));
    return {
      summary: `找到 ${tickets.length} 个工单，请选择想了解的具体工单：`,
      sources: [],
      attribution: {
        kind: "disambiguation" as const,
        entityType: "ticket" as const,
        candidates: ticketCandidates,
        count: tickets.length,
      },
      decision: {
        type: "human" as const,
        reason: `找到 ${tickets.length} 个工单，需要人工选择`,
        entityType: "ticket",
        candidates: ticketCandidates,
      },
    };
  }

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
