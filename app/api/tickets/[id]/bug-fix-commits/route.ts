import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;

    const ticketNo = Number(id);
    const bugTicket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: { userId: true },
        },
      },
    });

    if (!bugTicket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const canRead =
      bugTicket.creatorId === session.user.id ||
      bugTicket.assignees.some((a) => a.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canRead) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // 查找绑定记录
    const binding = await prisma.bugProgramBinding.findFirst({
      where: { bugTicketId: bugTicket.id },
      select: {
        fixCommitIds: true,
        programTicket: {
          select: {
            id: true,
            ticketNo: true,
            title: true,
            commits: {
              orderBy: { committedAt: "desc" },
            },
          },
        },
      },
    });

    if (!binding || binding.fixCommitIds.length === 0) {
      return NextResponse.json({ fixCommits: [] });
    }

    // 从程序单的提交中筛选出 fix commits
    const fixCommitPattern = /(?<=[\u4e00-\u9fa5a-zA-Z\s]|^)fix(?::|：|$|[\s\u4e00-\u9fa5])/i;
    const fixCommits = binding.programTicket.commits
      .filter((c) => binding.fixCommitIds.includes(c.id) && fixCommitPattern.test(c.subject))
      .map((c) => ({
        id: c.id,
        commitSha: c.commitSha.slice(0, 7),
        subject: c.subject,
        author: c.author,
        committedAt: c.committedAt.toISOString(),
        repoPath: c.repoPath,
      }));

    return NextResponse.json({
      fixCommits,
      programTicket: {
        ticketNo: binding.programTicket.ticketNo,
        title: binding.programTicket.title,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
