import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assertManagedRepoPath,
  isManagedGitRepo,
} from "@/lib/git-sync/repos";

const execFileAsync = promisify(execFile);

async function git(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

export async function getCommitDiff(repoPath: string, commitSha: string) {
  const resolved = assertManagedRepoPath(repoPath);
  if (!(await isManagedGitRepo(resolved))) {
    throw new Error("not a git repo");
  }
  const diff = await git(resolved, [
    "show",
    "--format=",
    "--patch-with-stat",
    "--no-color",
    commitSha,
  ]);
  return diff.trimEnd();
}
