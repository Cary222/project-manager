import fs from "node:fs/promises";
import path from "node:path";

export const ROOTS = ["/home/hxy/work/company", "/home/hxy/work/personal"];

export async function isWorkingGitRepo(repoPath: string) {
  try {
    const stat = await fs.stat(path.join(repoPath, ".git"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function isBareGitRepo(repoPath: string) {
  try {
    const head = await fs.stat(path.join(repoPath, "HEAD"));
    const objects = await fs.stat(path.join(repoPath, "objects"));
    return head.isFile() && objects.isDirectory();
  } catch {
    return false;
  }
}

export async function isManagedGitRepo(repoPath: string) {
  return (await isWorkingGitRepo(repoPath)) || (await isBareGitRepo(repoPath));
}

export function assertManagedRepoPath(repoPath: string) {
  const resolved = path.resolve(repoPath);
  const allowed = ROOTS.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
  if (!allowed) throw new Error("FORBIDDEN_REPO");
  return resolved;
}

export async function listManagedRepos() {
  const repos: string[] = [];
  const skipWorkingNames = new Set<string>();

  for (const root of ROOTS) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirNames = new Set(
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    );

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(".git")) continue;
      const barePath = path.join(root, entry.name);
      if (!(await isBareGitRepo(barePath))) continue;
      repos.push(barePath);
      const workName = entry.name.slice(0, -".git".length);
      if (dirNames.has(workName)) skipWorkingNames.add(workName);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.endsWith(".git")) continue;
      if (skipWorkingNames.has(entry.name)) continue;
      const repoPath = path.join(root, entry.name);
      if (await isWorkingGitRepo(repoPath)) repos.push(repoPath);
    }
  }

  return repos.sort();
}
