import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/shared/db/client";
import { getCommitBranches } from "@/lib/git-sync/branches";
import { parseTicketCommitSubject } from "@/entities/ticket/lib/parse-commit";
import { listManagedRepos } from "@/lib/git-sync/repos";
import { backfillSearchDocuments } from "@/features/knowledge/lib/search";
import { enqueueIndexJob } from "@/worker/lib/jobs";

const execFileAsync = promisify(execFile);
const SCAN_LIMIT = 500;

export type RawCommit = {
  sha: string;
  committedAt: Date;
  author: string;
  subject: string;
};

async function git(repoPath: string, args: string[]) {
  const fullArgs = ["-C", repoPath, ...args];
  const { stdout } = await execFileAsync("git", fullArgs, {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function parseLogLine(line: string): RawCommit | null {
  const [sha, date, author, ...subjectParts] = line.split("|");
  if (!sha) return null;
  return {
    sha,
    committedAt: new Date(date ?? ""),
    author: author ?? "unknown",
    subject: subjectParts.join("|"),
  };
}

export async function getRecentCommitsAllBranches(
  repoPath: string
): Promise<RawCommit[]> {
  console.log("DEBUG getRecentCommitsAllBranches called with:", repoPath);
  const cursor = await prisma.syncCursor.findUnique({ where: { repoPath } });
  console.log("DEBUG cursor:", cursor ? cursor.lastCommitAt : "NO CURSOR");
  const args = [
    "log",
    "--all",
    `--max-count=${SCAN_LIMIT}`,
    "--format=%H|%aI|%an|%s",
  ];

  if (cursor?.lastCommitAt) {
    // 增量：只拉上次同步时间之后（回退 1 小时避免边界遗漏）
    const since = new Date(cursor.lastCommitAt.getTime() - 3600_000);
    args.push(`--since=${since.toISOString()}`);
  }
  // 无游标时仅取最近 SCAN_LIMIT 条，非全仓库历史

  const output = await git(repoPath, args).catch((e) => {
    console.error("DEBUG git error:", e.message);
    return "";
  });
  console.log("DEBUG git output length:", output.length);

  if (!output) {
    console.log("DEBUG: output is empty");
    return [];
  }

  const result = output
    .split("\n")
    .filter(Boolean)
    .map(parseLogLine)
    .filter((item): item is RawCommit => !!item?.sha);
  console.log("DEBUG returning commits:", result.length);
  return result;
}

export async function syncRepoCommits(repoPath: string) {
  const commits = await getRecentCommitsAllBranches(repoPath);
  if (commits.length === 0) return { repoPath, total: 0, linked: 0 };

  let linked = 0;
  for (const commit of commits) {
    const parsed = parseTicketCommitSubject(commit.subject);
    if (!parsed) continue;

    const ticket = await prisma.ticket.findUnique({
      where: { ticketNo: parsed.ticketNo },
      select: { id: true },
    });
    if (!ticket) continue;

    const branches = await getCommitBranches(repoPath, commit.sha);

    await prisma.ticketCommit.upsert({
      where: { repoPath_commitSha: { repoPath, commitSha: commit.sha } },
      update: {
        author: commit.author,
        committedAt: commit.committedAt,
        subject: commit.subject,
        ticketNo: parsed.ticketNo,
        ticketId: ticket.id,
        branches,
      },
      create: {
        repoPath,
        commitSha: commit.sha,
        author: commit.author,
        committedAt: commit.committedAt,
        subject: commit.subject,
        ticketNo: parsed.ticketNo,
        ticketId: ticket.id,
        branches,
      },
    });
    const linkedCommit = await prisma.ticketCommit.findUnique({
      where: { repoPath_commitSha: { repoPath, commitSha: commit.sha } },
      include: {
        ticket: {
          include: {
            project: { select: { id: true, name: true } },
            module: { select: { name: true } },
          },
        },
      },
    });
    if (linkedCommit) {
      await enqueueIndexJob({ targetType: "COMMIT", targetId: linkedCommit.id });
    }
    linked += 1;
  }

  const newest = commits[0];
  await prisma.syncCursor.upsert({
    where: { repoPath },
    update: {
      lastCommitSha: newest?.sha,
      lastCommitAt: newest?.committedAt,
    },
    create: {
      repoPath,
      lastCommitSha: newest?.sha,
      lastCommitAt: newest?.committedAt,
    },
  });

  return { repoPath, total: commits.length, linked };
}

export async function syncAllManagedRepos() {
  const repos = await listManagedRepos();
  const result = [];
  for (const repoPath of repos) {
    result.push(await syncRepoCommits(repoPath));
  }
  return result;
}

export async function backfillCommitBranches() {
  const commits = await prisma.ticketCommit.findMany({
    select: { id: true, repoPath: true, commitSha: true, branches: true },
  });

  for (const commit of commits) {
    const branches = await getCommitBranches(commit.repoPath, commit.commitSha);
    const prev = commit.branches.join("\0");
    const next = branches.join("\0");
    if (prev !== next) {
      await prisma.ticketCommit.update({
        where: { id: commit.id },
        data: { branches },
      });
    }
  }
}

export async function backfillSearchIndex() {
  return backfillSearchDocuments();
}

export { listManagedRepos } from "@/lib/git-sync/repos";

// Keep old export name for any external imports
export const getNewCommits = getRecentCommitsAllBranches;
