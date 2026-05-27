import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { getCommitBranches } from "@/lib/git-sync/branches";
import { parseTicketCommitSubject } from "@/lib/git-sync/parse";

const execFileAsync = promisify(execFile);
const ROOTS = ["/home/hxy/work/company", "/home/hxy/work/personal"];
const SCAN_LIMIT = 500;

export type RawCommit = {
  sha: string;
  committedAt: Date;
  author: string;
  subject: string;
};

async function git(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

async function hasGitDir(repoPath: string) {
  try {
    const stat = await fs.stat(path.join(repoPath, ".git"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function listManagedRepos() {
  const repos: string[] = [];
  for (const root of ROOTS) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(root, entry.name);
      if (await hasGitDir(repoPath)) repos.push(repoPath);
    }
  }
  return repos.sort();
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
  const cursor = await prisma.syncCursor.findUnique({ where: { repoPath } });
  const args = [
    "log",
    "--all",
    `--max-count=${SCAN_LIMIT}`,
    "--format=%H|%aI|%an|%s",
  ];

  if (cursor?.lastCommitAt) {
    const since = new Date(cursor.lastCommitAt.getTime() - 3600_000);
    args.push(`--since=${since.toISOString()}`);
  }

  const output = await git(repoPath, args).catch(() => "");
  if (!output) return [];

  return output
    .split("\n")
    .filter(Boolean)
    .map(parseLogLine)
    .filter((item): item is RawCommit => !!item?.sha);
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
  await backfillCommitBranches();
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

// Keep old export name for any external imports
export const getNewCommits = getRecentCommitsAllBranches;
