/**
 * SvgArtifact - SVG 图形预览
 *
 * 使用 SandboxedIframe 沙箱渲染，确保安全隔离
 */

'use client';

import { useMemo } from 'react';
import { SandboxedIframe } from '../../ai-workspace/runtime/SandboxedIframe';
import type { Artifact } from '../../ai-workspace/types';

interface SvgArtifactProps {
  artifact: Artifact;
}

export function SvgArtifact({ artifact }: SvgArtifactProps) {
  // 使用 crypto.randomUUID 生成唯一 ID
  const sandboxId = useMemo(() => `svg-${crypto.randomUUID()}`, []);

  // 包装 SVG 为完整 HTML 以便在 iframe 中渲染
  const htmlContent = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: white;
    }
    svg {
      max-width: 100%;
      max-height: 100%;
    }
  </style>
</head>
<body>
  ${artifact.content}
</body>
</html>`;
  }, [artifact.content]);

  const handleDownload = () => {
    const blob = new Blob([artifact.content], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleError = (error: Error) => {
    console.error('[SvgArtifact] Sandbox error:', error);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700">{artifact.filename}</span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600">
            svg
          </span>
        </div>
        <button
          onClick={handleDownload}
          className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 hover:text-brand-700"
        >
          下载
        </button>
      </div>

      {/* Content - SandboxedIframe */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-white p-4">
        <SandboxedIframe
          sandboxId={sandboxId}
          html={htmlContent}
          sandbox="allow-scripts"
          className="max-h-full max-w-full"
          onError={handleError}
        />
      </div>
    </div>
  );
}
