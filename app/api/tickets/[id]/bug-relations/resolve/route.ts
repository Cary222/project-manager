import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

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

    // 加载源程序单的模块所属职责类型（必须）
    const sourceTicket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: { userId: true },
        },
        module: {
          include: {
            responsibility: {
              select: { kind: true },
            },
          },
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

    // 必须是 PROGRAM 类型的单子才能检索 Bug 单
    if (sourceTicket.module.responsibility.kind !== "PROGRAM") {
      return NextResponse.json({
        mode: "unbound",
        candidateTicket: null,
        shouldAutoCreate: false,
        fixCommitCount: 0,
        fixCommitIds: [],
        fixCommits: [],
      });
    }

    // 检查已绑定列表
    const existingBindings = await prisma.bugProgramBinding.findMany({
      where: { programTicketId: sourceTicket.id },
      select: { bugTicketId: true },
    });
    const boundBugIds = existingBindings.map((b) => b.bugTicketId);

    // 支持的 fix 关键词格式：
    // - fix:xxx / fix：xxx  （英文/中文冒号分隔）
    // - xxx fix xxx        （fix 作为独立词，前后有分隔）
    // - 故障fix / bug fix   （中文/英文词+空格+fix）
    // - fix                （句末的 fix）
    // 即：fix 前后有分隔符（冒号/空格/汉字）或出现在句末
    const fixCommitPattern = /(?<=[\u4e00-\u9fa5a-zA-Z\s]|^)fix(?::|：|$|[\s\u4e00-\u9fa5])/i;
    const fixCommits = sourceTicket.commits.filter((c) => fixCommitPattern.test(c.subject));

    // 查找 Bug 职责目录
    const bugResponsibility = sourceTicket.project.responsibilities.find(
      (r) => r.kind === "BUG"
    );
    const candidateModule =
      bugResponsibility?.modules.find((m) => m.name === sourceTicket.module.name) ?? null;

    let candidateBugTicket: { id: string; ticketNo: number; title: string } | null = null;

    // 优先级1：Bug 职责下，同模块 + 同名标题的 Bug 单
    if (candidateModule) {
      const sameModuleBug = await prisma.ticket.findFirst({
        where: {
          id: { not: sourceTicket.id, notIn: boundBugIds },
          projectId: sourceTicket.projectId,
          moduleId: candidateModule.id,
          module: {
            responsibility: { kind: "BUG" },
          },
          title: normalizeText(sourceTicket.title),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, ticketNo: true, title: true },
      });
      if (sameModuleBug) {
        candidateBugTicket = sameModuleBug;
      }
    }

    // 优先级2：从 fix 提交中提取被修复的单号，在 Bug 职责下查找对应单
    if (!candidateBugTicket && fixCommits.length > 0) {
      for (const commit of fixCommits) {
        const ticketNoMatch = commit.subject.match(/#(\d{5,})/);
        if (ticketNoMatch) {
          const referencedTicketNo = parseInt(ticketNoMatch[1], 10);
          // 必须在 Bug 职责下，排除源程序单本身
          const referencedBug = await prisma.ticket.findFirst({
            where: {
              ticketNo: referencedTicketNo,
              id: { not: sourceTicket.id, notIn: boundBugIds },
              module: { responsibility: { kind: "BUG" } },
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

    // 优先级3：有 fix 提交但没找到候选 Bug 单 → 预填 fix 信息引导用户创建
    const shouldAutoCreate = !candidateBugTicket && fixCommits.length > 0;

    // 优先级4：Bug 职责下，标题包含源程序单标题的 Bug 单（无 fix 提交时）
    if (!candidateBugTicket && !shouldAutoCreate) {
      const similarBug = await prisma.ticket.findFirst({
        where: {
          projectId: sourceTicket.projectId,
          id: { not: sourceTicket.id, notIn: boundBugIds },
          module: { responsibility: { kind: "BUG" } },
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
