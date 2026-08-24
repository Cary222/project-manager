import { readdir, stat, realpath, readFile } from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

export function shouldShowWindowsDrivePicker(
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !directory;
}

export function getBrowseStartDirectory(directory?: string): string {
  return directory || homedir();
}

export function getWindowsDriveCandidates(): BrowsableDirectory[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    name: `${letter}:`,
    path: `${letter}:\\`,
  }));
}

export async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const candidates = await Promise.all(getWindowsDriveCandidates().map(async (drive) => {
    try {
      const driveStat = await stat(drive.path);
      return driveStat.isDirectory() ? drive : null;
    } catch {
      return null;
    }
  }));

  return candidates.filter((drive): drive is BrowsableDirectory => drive !== null);
}

export function normalizeDirectory(directory: string): string {
  if (directory === "~") return homedir();
  if (directory.startsWith("~/")) return path.resolve(homedir(), directory.slice(2));
  return path.resolve(directory);
}

export function getParentDirectory(directory: string): string | null {
  const pathApi = /^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
    ? path.win32
    : path.posix;
  const normalized = pathApi.normalize(directory);
  const parent = pathApi.dirname(normalized);
  return parent === normalized ? null : parent;
}

export async function resolveDirectory(directory: string): Promise<string> {
  return realpath(normalizeDirectory(directory));
}

export async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  // 忽略损坏、不可访问或不指向目录的符号链接。
  const candidates = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return { name: entry.name, path: path.join(directory, entry.name) };
    }
    if (!entry.isSymbolicLink()) return null;

    try {
      const entryPath = path.join(directory, entry.name);
      const realEntryPath = await realpath(entryPath);
      const entryStat = await stat(realEntryPath);
      if (!entryStat.isDirectory()) return null;
      return { name: entry.name, path: entryPath };
    } catch {
      return null;
    }
  }));

  return candidates
    .filter((entry): entry is BrowsableDirectory => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export interface FileListEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
}

export async function listFiles(
  dirPath: string,
  type: string,
  params: URLSearchParams,
): Promise<{ entries?: FileListEntry[]; content?: string; error?: string }> {
  if (type === "list") {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        let isDir = entry.isDirectory();
        let size = 0;
        let modified = 0;
        try {
          if (entry.isSymbolicLink()) {
            try {
              const real = await realpath(fullPath);
              const s = await stat(real);
              isDir = s.isDirectory();
              size = s.size;
              modified = s.mtimeMs;
            } catch {
              isDir = false;
            }
          } else {
            const s = await stat(fullPath);
            size = s.size;
            modified = s.mtimeMs;
          }
        } catch {
          // inaccessible
        }
        return { name: entry.name, isDir, size, modified } satisfies FileListEntry;
      }),
    );
    return { entries: results };
  }

  if (type === "read") {
    const encoding = params.get("encoding") ?? "utf8";
    const content = await readFile(dirPath, encoding as "utf8" | "base64");
    return { content };
  }

  return { error: `Unknown type: ${type}` };
}
