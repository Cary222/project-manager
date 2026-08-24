/**
 * HtmlArtifact - HTML 文档预览组件
 *
 * Phase 2 升级版：使用 SandboxedIframe 安全沙箱
 */

'use client';

import { useMemo } from 'react';
import { SandboxedIframe } from '../../ai-workspace/runtime/SandboxedIframe';
import type { Artifact } from '../../ai-workspace/types';
import { ensureCompleteHtml, validateHtml } from '../../ai-workspace/utils/validate-html';

interface HtmlArtifactProps {
  artifact: Artifact;
}

export function HtmlArtifact({ artifact }: HtmlArtifactProps) {
  // 使用 crypto.randomUUID 生成唯一 ID
  const sandboxId = useMemo(() => `html-${crypto.randomUUID()}`, []);

  // 验证和补全 HTML
  const { htmlContent, validation } = useMemo(() => {
    const validation = validateHtml(artifact.content);
    const htmlContent = ensureCompleteHtml(artifact.content);

    return { htmlContent, validation };
  }, [artifact.content]);

  const handleDownload = () => {
    const blob = new Blob([artifact.content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleError = (error: Error) => {
    console.error('[HtmlArtifact] Sandbox error:', error);
  };

  const handleConsole = (entry: { type: string; text: string }) => {
    console.log(`[HtmlArtifact] [${entry.type}] ${entry.text}`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700">{artifact.filename}</span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600">
            html
          </span>
        </div>
        <button
          onClick={handleDownload}
          className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 hover:text-brand-700"
        >
          下载
        </button>
      </div>

      {/* Content - SandboxedIframe Preview */}
      <div className="flex-1 overflow-hidden bg-white">
        {validation.isValid ? (
          <SandboxedIframe
            sandboxId={sandboxId}
            html={htmlContent}
            sandbox="allow-scripts"
            onError={handleError}
            onConsole={handleConsole}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="text-center">
              <p className="text-sm font-medium text-danger-600">HTML 内容无效</p>
              <ul className="mt-2 space-y-1 text-xs text-ink-600">
                {validation.errors.map((error: string, i: number) => (
                  <li key={i}>• {error}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
