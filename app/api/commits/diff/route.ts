import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCommitDiff } from "@/lib/git-sync/diff";
import { requireSession } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const repoPath = searchParams.get("repoPath");
    const commitSha = searchParams.get("sha");

    if (!repoPath || !commitSha) {
      return NextResponse.json(
        { error: "repoPath and sha are required" },
        { status: 400 }
      );
    }

    const linked = await prisma.ticketCommit.findFirst({
      where: {
        repoPath,
        commitSha: { startsWith: commitSha },
      },
      select: { id: true, commitSha: true },
    });
    if (!linked) {
      return NextResponse.json({ error: "commit not found" }, { status: 404 });
    }

    const diff = await getCommitDiff(repoPath, linked.commitSha);
    return NextResponse.json({ diff });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "FORBIDDEN_REPO") {
      return NextResponse.json({ error: "forbidden repo" }, { status: 403 });
    }
    if (message.includes("ENOENT") || message.includes("fatal:")) {
      return NextResponse.json({ error: "diff unavailable" }, { status: 404 });
    }
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
