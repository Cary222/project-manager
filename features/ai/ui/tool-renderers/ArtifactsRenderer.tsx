/**
 * ArtifactsRenderer - artifacts 工具渲染器
 * 
 * 渲染 artifacts 工具调用结果，显示文件操作状态
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { FileCode2 } from 'lucide-react';
import { useArtifactStore } from '@/features/ai/ui/artifacts/artifact-store';

export function ArtifactsRenderer({
  input,
  output,
  status,
  error,
}: ToolCallRendererProps) {
  const setActive = useArtifactStore((state) => state.setActive);

  if (status === 'error' || error) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
        <div className="flex items-center gap-2 text-sm text-danger-700">
          <FileCode2 className="h-4 w-4" />
          <span className="font-medium">Artifact operation failed</span>
        </div>
        <p className="mt-1 text-xs text-danger-600">{error}</p>
      </div>
    );
  }

  const command = input.command as string;
  const filename = input.filename as string;

  let actionText = '';
  let bgColor = 'bg-brand-50';
  let textColor = 'text-brand-700';
  let borderColor = 'border-brand-200';

  switch (command) {
    case 'create':
      actionText = 'Created';
      bgColor = 'bg-success-50';
      textColor = 'text-success-700';
      borderColor = 'border-success-200';
      break;
    case 'update':
      actionText = 'Updated';
      bgColor = 'bg-brand-50';
      textColor = 'text-brand-700';
      borderColor = 'border-brand-200';
      break;
    case 'rewrite':
      actionText = 'Rewrote';
      bgColor = 'bg-warning-50';
      textColor = 'text-warning-700';
      borderColor = 'border-warning-200';
      break;
    case 'delete':
      actionText = 'Deleted';
      bgColor = 'bg-ink-50';
      textColor = 'text-ink-600';
      borderColor = 'border-ink-200';
      break;
    default:
      actionText = command;
  }

  return (
    <div
      className={`rounded-lg border ${borderColor} ${bgColor} p-3 transition-colors hover:opacity-80`}
    >
      <div className="flex items-center gap-2">
        <FileCode2 className={`h-4 w-4 ${textColor}`} />
        <span className={`text-sm font-medium ${textColor}`}>
          {actionText}
        </span>
        <button
          onClick={() => filename && setActive(filename)}
          className={`text-sm font-mono ${textColor} underline decoration-dotted hover:decoration-solid`}
        >
          {filename}
        </button>
      </div>
      {output?.message && (
        <p className={`mt-1 text-xs ${textColor.replace('700', '600')}`}>
          {output.message}
        </p>
      )}
    </div>
  );
}
