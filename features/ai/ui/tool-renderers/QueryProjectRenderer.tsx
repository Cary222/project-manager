/**
 * QueryProjectRenderer - query_project 工具渲染器
 * 
 * 渲染项目查询结果
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { FolderOpen } from 'lucide-react';

export function QueryProjectRenderer({
  output,
  status,
  error,
}: ToolCallRendererProps) {
  if (status === 'error' || error) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
        <div className="flex items-center gap-2 text-sm text-danger-700">
          <FolderOpen className="h-4 w-4" />
          <span>Failed to query project: {error}</span>
        </div>
      </div>
    );
  }

  if (!output?.success || !output?.data) {
    return null;
  }

  const project = output.data;

  return (
    <div className="rounded-lg border border-brand-200 bg-white p-4">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-ink-100 pb-2">
        <FolderOpen className="h-5 w-5 text-brand-600" />
        <h3 className="text-sm font-semibold text-ink-900">{project.name}</h3>
      </div>

      {/* Content */}
      <div className="mt-3 space-y-2">
        {project.description && (
          <p className="text-sm text-ink-700">{project.description}</p>
        )}

        {/* Stats */}
        <div className="flex gap-4 text-xs text-ink-600">
          {project.tickets && (
            <span>{project.tickets.length} tickets</span>
          )}
          {project.members && (
            <span>{project.members.length} members</span>
          )}
          {project.modules && (
            <span>{project.modules.length} modules</span>
          )}
        </div>
      </div>
    </div>
  );
}
