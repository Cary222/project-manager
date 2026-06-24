import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SSH_USER = "hxy";
const SSH_HOST = "192.168.1.14";
const IS_LOCAL = process.env.NODE_ENV === "development";

async function git(repoPath: string, args: string[]) {
  let cmd: string;
  if (IS_LOCAL) {
    cmd = `ssh ${SSH_USER}@${SSH_HOST} "cd '${repoPath}' && git ${args.join(" ")}"`;
  } else {
    cmd = `git -C '${repoPath}' ${args.join(" ")}`;
  }
  const { stdout } = await execFileAsync("sh", ["-c", cmd], {
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
