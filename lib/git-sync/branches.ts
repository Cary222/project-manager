import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

function normalizeBranch(name: string) {
  return name.replace(/^origin\//, "");
}

export async function getCommitBranches(
  repoPath: string,
  commitSha: string
): Promise<string[]> {
  const output = await git(repoPath, [
    "for-each-ref",
    "--contains",
    commitSha,
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]).catch(() => "");

  if (!output) return [];

  const branches = [
    ...new Set(
      output
        .split("\n")
        .map((line) => normalizeBranch(line.trim()))
        .filter(Boolean)
        .filter((name) => name !== "HEAD")
    ),
  ];

  return branches.sort((a, b) => a.localeCompare(b, "zh-CN"));
}
