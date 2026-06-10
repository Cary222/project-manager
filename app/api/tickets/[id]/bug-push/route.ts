import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

type BugCommit = {
  id: string;
  commitSha: string;
  subject: string;
  author: string;
  committedAt: string;
  repoPath: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: { userId: true },
        },
        module: {
          select: {
            responsibility: {
              select: { kind: true },
            },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const canRead =
      ticket.creatorId === session.user.id ||
      ticket.assignees.some((a) => a.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canRead) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const fixCommitPattern = /^fix[:：]\s*/i;

    const commits = await prisma.ticketCommit.findMany({
      where: {
        ticketId: ticket.id,
        subject: {
          contains: "fix:",
          mode: "insensitive",
        },
      },
      orderBy: { committedAt: "desc" },
    });

    const bugCommits: BugCommit[] = commits
      .filter((c) => fixCommitPattern.test(c.subject))
      .map((c) => ({
        id: c.id,
        commitSha: c.commitSha,
        subject: c.subject,
        author: c.author,
        committedAt: c.committedAt.toISOString(),
        repoPath: c.repoPath,
      }));

    return NextResponse.json({
      hasBug: bugCommits.length > 0,
      bugCommits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
