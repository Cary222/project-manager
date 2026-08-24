/**
 * ThinkingRenderer - thinking 工具渲染器
 * 
 * 渲染 Work Agent 的思考过程
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { Brain } from 'lucide-react';
import { useState } from 'react';

export function ThinkingRenderer({
  input,
  output,
  status,
}: ToolCallRendererProps) {
  const [expanded, setExpanded] = useState(false);

  const thought = input.thought || output?.thought || '';

  if (!thought) {
    return null;
  }

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Brain className="h-4 w-4 text-brand-700" />
        <span className="text-sm font-medium text-brand-700">Thinking</span>
        {status === 'pending' && (
          <span className="ml-auto animate-pulse text-xs text-brand-600">
            ...
          </span>
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div className="mt-2 text-sm text-brand-700 whitespace-pre-wrap">
          {thought}
        </div>
      )}
    </div>
  );
}
