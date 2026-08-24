/**
 * QueryCommitsRenderer - query_commits 工具渲染器
 * 
 * 渲染 Git 提交记录查询结果（简化版）
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { GitCommit } from 'lucide-react';

export function QueryCommitsRenderer({
  output,
  status,
  error,
}: ToolCallRendererProps) {
  if (status === 'error' || error) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
        <div className="flex items-center gap-2 text-sm text-danger-700">
          <GitCommit className="h-4 w-4" />
          <span>Failed to query commits: {error}</span>
        </div>
      </div>
    );
  }

  if (!output?.success || !output?.data) {
    return null;
  }

  const commits = output.data || [];
  const count = output.count || commits.length;

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-ink-100 pb-2">
        <GitCommit className="h-4 w-4 text-ink-600" />
        <span className="text-sm font-medium text-ink-700">
          {count} {count === 1 ? 'commit' : 'commits'}
        </span>
      </div>

      {/* Commits List (first 3) */}
      {commits.length > 0 && (
        <div className="mt-2 space-y-1">
          {commits.slice(0, 3).map((commit: any, idx: number) => (
            <div key={idx} className="text-xs">
              <span className="font-mono text-ink-500">
                {commit.sha?.substring(0, 7) || commit.commitSha?.substring(0, 7)}
              </span>
              <span className="ml-2 text-ink-700">
                {commit.message || commit.subject}
              </span>
            </div>
          ))}
          {commits.length > 3 && (
            <div className="text-xs text-ink-500">
              ... and {commits.length - 3} more
            </div>
          )}
        </div>
      )}

      {commits.length === 0 && (
        <p className="mt-2 text-xs text-ink-500">No commits found</p>
      )}
    </div>
  );
}
