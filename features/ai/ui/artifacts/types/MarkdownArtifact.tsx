/**
 * MarkdownArtifact - Markdown 文档预览
 * 使用 react-markdown + remark-gfm
 */

'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Artifact } from '../../ai-workspace/types';

interface MarkdownArtifactProps {
  artifact: Artifact;
}

export function MarkdownArtifact({ artifact }: MarkdownArtifactProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700">{artifact.filename}</span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600">
            markdown
          </span>
        </div>
        <button
          onClick={() => {
            const blob = new Blob([artifact.content], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = artifact.filename;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 hover:text-brand-700"
        >
          下载
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-white p-6">
        <article className="prose prose-sm max-w-none prose-headings:text-ink-900 prose-p:text-ink-700 prose-a:text-brand-600 prose-strong:text-ink-900 prose-code:text-brand-700 prose-code:bg-brand-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-ink-900 prose-pre:text-ink-50">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {artifact.content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
