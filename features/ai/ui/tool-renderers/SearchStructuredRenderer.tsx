/**
 * SearchStructuredRenderer - search_structured 工具渲染器
 * 
 * 渲染文档搜索结果
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { Search } from 'lucide-react';
import { useState } from 'react';

export function SearchStructuredRenderer({
  input,
  output,
  status,
  error,
}: ToolCallRendererProps) {
  const [expanded, setExpanded] = useState(false);

  if (status === 'error' || error) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
        <div className="flex items-center gap-2 text-sm text-danger-700">
          <Search className="h-4 w-4" />
          <span>Search failed: {error}</span>
        </div>
      </div>
    );
  }

  const query = input.query as string;
  const results = output?.results || [];
  const count = results.length;

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-brand-700" />
          <span className="text-sm font-medium text-brand-700">
            Search: "{query}"
          </span>
        </div>
        <span className="text-xs text-brand-600">
          {count} {count === 1 ? 'result' : 'results'}
        </span>
      </div>

      {/* Results Preview (first 3) */}
      {results.length > 0 && (
        <div className="mt-2 space-y-2">
          {results.slice(0, expanded ? undefined : 3).map((result: any, idx: number) => (
            <div
              key={idx}
              className="rounded border border-brand-100 bg-white p-2"
            >
              <div className="text-xs font-medium text-ink-700">
                {result.title || result.filename || `Result ${idx + 1}`}
              </div>
              {result.snippet && (
                <p className="mt-1 text-xs text-ink-600 line-clamp-2">
                  {result.snippet}
                </p>
              )}
            </div>
          ))}

          {/* Expand/Collapse */}
          {results.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-brand-700 hover:underline"
            >
              {expanded
                ? 'Show less'
                : `Show ${results.length - 3} more results`}
            </button>
          )}
        </div>
      )}

      {/* No Results */}
      {results.length === 0 && status === 'success' && (
        <p className="mt-2 text-xs text-brand-600">No results found</p>
      )}
    </div>
  );
}
