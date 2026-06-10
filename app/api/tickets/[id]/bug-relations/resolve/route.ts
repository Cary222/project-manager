import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const sourceTicket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: { userId: true },
        },
        module: {
          select: { name: true },
        },
        project: {
          include: {
            responsibilities: {
              include: {
                modules: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        commits: {
          orderBy: { committedAt: "desc" },
        },
      },
    });

    if (!sourceTicket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const canRead =
      sourceTicket.creatorId === session.user.id ||
      sourceTicket.assignees.some((a) => a.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canRead) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // 检查已绑定列表
    const existingBindings = await prisma.bugProgramBinding.findMany({
      where: { programTicketId: sourceTicket.id },
      select: { bugTicketId: true },
    });
    const boundBugIds = existingBindings.map((b) => b.bugTicketId);

    // 检查是否有 fix: 关键词的提交
    // 支持格式：fix:xxx, fix：xxx, fix修补xxx, ，fix修补xxx 等
    const fixCommitPattern = /(?:^|[，,、\s])fix[:：\s]*/i;
    const fixCommits = sourceTicket.commits.filter((c) => fixCommitPattern.test(c.subject));

    // 查找 Bug 职责目录
    const bugResponsibility = sourceTicket.project.responsibilities.find(
      (r) => r.kind === "BUG"
    );
    const candidateModule =
      bugResponsibility?.modules.find((m) => m.name === sourceTicket.module.name) ?? null;

    let candidateBugTicket: { id: string; ticketNo: number; title: string } | null = null;

    // 优先级1：同一模块下同名 Bug 单
    if (candidateModule) {
      const sameModuleBug = await prisma.ticket.findFirst({
        where: {
          id: { not: sourceTicket.id, notIn: boundBugIds },
          projectId: sourceTicket.projectId,
          moduleId: candidateModule.id,
          title: normalizeText(sourceTicket.title),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, ticketNo: true, title: true },
      });
      if (sameModuleBug) {
        candidateBugTicket = sameModuleBug;
      }
    }

    // 优先级2：从 fix 提交中提取被修复的单号，查找对应 Bug 单
    // 排除源程序单本身（fix 提交通常是关于自身的问题）
    if (!candidateBugTicket && fixCommits.length > 0) {
      for (const commit of fixCommits) {
        // 提取 #XXXXX 格式的单号
        const ticketNoMatch = commit.subject.match(/#(\d{5,})/);
        if (ticketNoMatch) {
          const referencedTicketNo = parseInt(ticketNoMatch[1], 10);
          // 查找该单号的 Bug 单（排除源程序单本身）
          const referencedBug = await prisma.ticket.findFirst({
            where: {
              ticketNo: referencedTicketNo,
              id: { not: sourceTicket.id, notIn: boundBugIds },
            },
            select: { id: true, ticketNo: true, title: true },
          });
          if (referencedBug) {
            candidateBugTicket = referencedBug;
            break;
          }
        }
      }
    }

    // 优先级3：如果有 fix 提交但没有找到候选 Bug 单，
    // 说明这些 fix 是修复本程序的问题，应该创建一个新的 Bug 单
    const shouldAutoCreate = !candidateBugTicket && fixCommits.length > 0;

    // 优先级3（修改）：查找标题包含源程序单标题的 Bug 单
    // 但如果有 fix 提交，跳过这步（fix 提交说明问题不在现有单里）
    if (!candidateBugTicket && !shouldAutoCreate) {
      const similarBug = await prisma.ticket.findFirst({
        where: {
          projectId: sourceTicket.projectId,
          id: { not: sourceTicket.id, notIn: boundBugIds },
          OR: [
            { title: { contains: normalizeText(sourceTicket.title) } },
            { title: { contains: `Bug: ${normalizeText(sourceTicket.title)}` } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, ticketNo: true, title: true },
      });
      if (similarBug) {
        candidateBugTicket = similarBug;
      }
    }

    // 权限检查：用户必须对候选 Bug 单有读权限
    let accessibleCandidate: typeof candidateBugTicket = null;
    if (candidateBugTicket) {
      const bugTicketWithAccess = await prisma.ticket.findUnique({
        where: { id: candidateBugTicket.id },
        include: { assignees: { select: { userId: true } } },
      });
      if (
        bugTicketWithAccess &&
        (bugTicketWithAccess.creatorId === session.user.id ||
          bugTicketWithAccess.assignees.some((a) => a.userId === session.user.id) ||
          session.user.role === "ROOT")
      ) {
        accessibleCandidate = candidateBugTicket;
      }
    }

    return NextResponse.json({
      mode: accessibleCandidate ? "candidate" : "unbound",
      candidateTicket: accessibleCandidate,
      shouldAutoCreate: shouldAutoCreate && !accessibleCandidate,
      fixCommitCount: fixCommits.length,
      fixCommitIds: fixCommits.map((c) => c.id),
      fixCommits: fixCommits.slice(0, 3).map((c) => ({
        id: c.id,
        commitSha: c.commitSha.slice(0, 7),
        subject: c.subject,
        author: c.author,
        committedAt: c.committedAt.toISOString(),
        repoPath: c.repoPath,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
