"use client";

import { useMemo } from "react";
import { branchStyle, repoStyle } from "@/lib/repo-style";
import { type CommitSummary } from "../modal/CommitDiffModal";

type CommitListProps = {
  commits: (CommitSummary & { id?: string })[];
  onCommitClick?: (commit: CommitSummary) => void;
  emptyText?: string;
  borderColor?: string;
};

export function CommitList({ commits, onCommitClick, emptyText = "暂无关联提交", borderColor = "border-ink-100" }: CommitListProps) {
  const commitsWithKey = useMemo(() => 
    commits.map((c, i) => ({ ...c, _key: c.id ?? c.commitSha ?? `commit-${i}` })),
    [commits]
  );

  if (commits.length === 0) {
    return (
      <p className={`rounded-lg border border-dashed ${borderColor} p-8 text-center text-sm text-ink-400`}>
        {emptyText}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {commitsWithKey.map((commit) => {
        const repo = repoStyle(commit.repoPath || "");
        return (
          <button
            key={commit._key}
            type="button"
            onClick={() => onCommitClick?.(commit)}
            className={`w-full rounded-lg border border-l-4 ${repo.border} p-3 text-left text-sm transition hover:border-ink-300 ${repo.card}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${repo.badge}`}>{repo.name}</span>
                <span className="font-mono text-xs text-ink-500">{commit.commitSha.slice(0, 7)}</span>
              </div>
              <span className="shrink-0 text-xs text-ink-400">
                {new Date(commit.committedAt).toLocaleString()}
              </span>
            </div>
            {commit.branches && commit.branches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {commit.branches.map((branch) => (
                  <span key={branch} className={`rounded px-2 py-0.5 text-xs ${branchStyle(branch)}`}>{branch}</span>
                ))}
              </div>
            )}
            <p className="mt-2 text-ink-700">{commit.subject}</p>
            <p className="mt-1 text-xs text-ink-400">{commit.author}</p>
          </button>
        );
      })}
    </div>
  );
}
