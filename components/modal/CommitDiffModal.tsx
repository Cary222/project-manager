"use client";

import { useEffect, useState } from "react";
import { branchStyle, repoStyle } from "@/lib/repo-style";

export type CommitSummary = {
  commitSha: string;
  subject: string;
  author: string;
  committedAt: string;
  repoPath: string;
  branches?: string[];
};

type CommitDiffModalProps = {
  commit: CommitSummary | null;
  onClose: () => void;
};

function diffLineClass(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "text-zinc-500";
  }
  if (line.startsWith("@@")) {
    return "bg-sky-50 text-sky-800";
  }
  if (line.startsWith("+")) {
    return "bg-emerald-50 text-emerald-900";
  }
  if (line.startsWith("-")) {
    return "bg-red-50 text-red-900";
  }
  return "text-zinc-700";
}

export function CommitDiffModal({ commit, onClose }: CommitDiffModalProps) {
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!commit) {
      setDiff("");
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDiff("");

    const params = new URLSearchParams({
      repoPath: commit.repoPath,
      sha: commit.commitSha,
    });

    fetch(`/api/commits/diff?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? "加载 diff 失败");
        }
        return res.json() as Promise<{ diff: string }>;
      })
      .then((data) => setDiff(data.diff || "（无变更内容）"))
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message || "加载 diff 失败");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [commit]);

  useEffect(() => {
    if (!commit) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit, onClose]);

  if (!commit) return null;

  const repo = repoStyle(commit.repoPath);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${repo.badge}`}>
                {repo.name}
              </span>
              <p className="font-mono text-sm text-zinc-500">
                {commit.commitSha.slice(0, 7)}
              </p>
            </div>
            <h2 className="mt-1 text-lg font-semibold">{commit.subject}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {commit.author} · {new Date(commit.committedAt).toLocaleString()}
            </p>
            <p className="mt-1 truncate text-xs text-zinc-400">
              {commit.repoPath}
            </p>
            {commit.branches && commit.branches.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {commit.branches.map((branch) => (
                  <span
                    key={branch}
                    className={`rounded px-2 py-0.5 text-xs ${branchStyle(branch)}`}
                  >
                    {branch}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-zinc-50 p-4">
          {loading ? (
            <p className="text-sm text-zinc-500">加载 diff 中...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-white font-mono text-xs leading-5">
              {diff.split("\n").map((line, index) => (
                <div key={index} className={`px-2 ${diffLineClass(line)}`}>
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
