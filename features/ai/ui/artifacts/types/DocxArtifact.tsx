/**
 * DocxArtifact - Word 文档预览渲染器
 * 使用 docx-preview 库的 renderAsync 渲染
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import type { Artifact } from '../../ai-workspace/types';
import { base64ToArrayBuffer, decodeBase64 } from '../utils/base64-decoder';

interface DocxArtifactProps {
  artifact: Artifact;
}

export function DocxArtifact({ artifact }: DocxArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const renderDocx = async () => {
      const container = containerRef.current;
      if (!container || !artifact.content) return;

      setIsLoading(true);
      setError(null);

      try {
        const { renderAsync } = await import('docx-preview');

        const arrayBuffer = base64ToArrayBuffer(artifact.content);

        // 清空容器
        container.innerHTML = '';

        // 创建包装器
        const wrapper = document.createElement('div');
        wrapper.className = 'docx-wrapper-custom';
        container.appendChild(wrapper);

        // 渲染 DOCX
        await renderAsync(arrayBuffer, wrapper, undefined, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: true,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });

        if (cancelled) return;

        // 注入自定义样式
        const style = document.createElement('style');
        style.textContent = `
          .docx-wrapper-custom {
            max-width: 100%;
            overflow-x: auto;
          }

          .docx-wrapper-custom .docx-wrapper {
            max-width: 100% !important;
            margin: 0 !important;
            background: transparent !important;
            padding: 0em !important;
          }

          .docx-wrapper-custom .docx-wrapper > section.docx {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 1.5em !important;
            background: white !important;
            color: inherit !important;
            max-width: 100% !important;
            width: 100% !important;
            min-width: 0 !important;
            overflow-x: auto !important;
          }

          .docx-wrapper-custom table {
            max-width: 100% !important;
            width: auto !important;
            overflow-x: auto !important;
            display: block !important;
          }

          .docx-wrapper-custom img {
            max-width: 100% !important;
            height: auto !important;
          }

          .docx-wrapper-custom p,
          .docx-wrapper-custom span,
          .docx-wrapper-custom div {
            max-width: 100% !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
          }

          .docx-wrapper-custom .docx-page-break {
            display: none !important;
          }
        `;
        container.appendChild(style);

        setIsLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error rendering DOCX:', err);
        setError(err instanceof Error ? err.message : 'Word 文档加载失败');
        setIsLoading(false);
      }
    };

    renderDocx();

    return () => {
      cancelled = true;
    };
  }, [artifact.content]);

  const handleDownload = () => {
    const bytes = decodeBase64(artifact.content);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4 bg-background">
        <div className="flex items-center gap-3 p-4 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-lg max-w-2xl">
          <AlertTriangle className="w-5 h-5 text-danger-600" />
          <div>
            <div className="font-medium text-danger-900 dark:text-danger-100">Word 文档加载失败</div>
            <div className="text-sm text-danger-700 dark:text-danger-300">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b border-ink-200 dark:border-ink-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700 dark:text-ink-300">
            {artifact.filename}
          </span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600 dark:bg-ink-700 dark:text-ink-300">
            docx
          </span>
        </div>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors text-ink-700 dark:text-ink-300"
          title="下载"
        >
          <Download className="w-4 h-4" />
          <span>下载</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-white dark:bg-ink-950">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-ink-500">加载中...</div>
          </div>
        )}
        <div ref={containerRef} className="docx-container" />
      </div>
    </div>
  );
}
