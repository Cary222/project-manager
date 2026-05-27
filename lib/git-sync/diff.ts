import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOTS = ["/home/hxy/work/company", "/home/hxy/work/personal"];

export function assertManagedRepoPath(repoPath: string) {
  const resolved = path.resolve(repoPath);
  const allowed = ROOTS.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
  if (!allowed) throw new Error("FORBIDDEN_REPO");
  return resolved;
}

async function git(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

export async function getCommitDiff(repoPath: string, commitSha: string) {
  const resolved = assertManagedRepoPath(repoPath);
  await fs.access(path.join(resolved, ".git"));
  const diff = await git(resolved, [
    "show",
    "--format=",
    "--patch-with-stat",
    "--no-color",
    commitSha,
  ]);
  return diff.trimEnd();
}
