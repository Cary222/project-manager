import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertManagedRepoPath } from "@/lib/git-sync/repos";

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
  return stdout;
}

export async function getCommitDiff(repoPath: string, commitSha: string) {
  assertManagedRepoPath(repoPath);
  const diff = await git(repoPath, [
    "show",
    "--format=",
    "--patch-with-stat",
    "--no-color",
    commitSha,
  ]);
  return diff.trimEnd();
}
