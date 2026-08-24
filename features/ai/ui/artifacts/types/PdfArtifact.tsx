/**
 * PdfArtifact - PDF 预览渲染器
 * 使用 PDF.js，通过 CDN worker 渲染
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import type * as pdfjsLib from 'pdfjs-dist';
import type { Artifact } from '../../ai-workspace/types';
import { base64ToArrayBuffer, decodeBase64 } from '../utils/base64-decoder';

interface PdfArtifactProps {
  artifact: Artifact;
}

// 配置 PDF.js worker（使用 CDN）
let workerConfigured = false;
let pdfjsModule: typeof pdfjsLib | null = null;

async function getPdfJs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist');
  }
  return pdfjsModule;
}

export function PdfArtifact({ artifact }: PdfArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const renderPdf = async () => {
      const container = containerRef.current;
      if (!container || !artifact.content) return;

      setIsLoading(true);
      setError(null);

      try {
        const pdfjs = await getPdfJs();

        // 配置 worker（仅首次）
        if (!workerConfigured) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
          workerConfigured = true;
        }

        const arrayBuffer = base64ToArrayBuffer(artifact.content);

        // 取消之前的加载任务
        if (loadingTaskRef.current) {
          loadingTaskRef.current.destroy();
          loadingTaskRef.current = null;
        }

        loadingTaskRef.current = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTaskRef.current.promise;

        if (cancelled || !containerRef.current) {
          pdf.destroy();
          return;
        }

        loadingTaskRef.current = null;

        // 清空容器
        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'p-4 space-y-4';
        container.appendChild(wrapper);

        // 渲染所有页面
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) break;

          const page = await pdf.getPage(pageNum);

          const pageContainer = document.createElement('div');
          pageContainer.className = 'mb-4 last:mb-0';

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');

          const viewport = page.getViewport({ scale: 1.5 });
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.className =
            'w-full max-w-full h-auto block mx-auto bg-white rounded-lg shadow-sm border border-ink-200';

          if (context) {
            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);
          }

        await page.render({
          canvasContext: context!,
          viewport: viewport,
        }).promise;

          pageContainer.appendChild(canvas);

          // 页码分隔（最后一页不加）
          if (pageNum < pdf.numPages) {
            const separator = document.createElement('div');
            separator.className = 'h-px bg-ink-200 my-4';
            pageContainer.appendChild(separator);
          }

          wrapper.appendChild(pageContainer);
        }

        setIsLoading(false);
        pdf.destroy();
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error rendering PDF:', err);
        setError(err instanceof Error ? err.message : 'PDF 加载失败');
        setIsLoading(false);
      }
    };

    renderPdf();

    return () => {
      cancelled = true;
      if (loadingTaskRef.current) {
        loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
    };
  }, [artifact.content, artifact.filename]);

  const handleDownload = () => {
    const bytes = decodeBase64(artifact.content);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
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
            <div className="font-medium text-danger-900 dark:text-danger-100">PDF 加载失败</div>
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
            pdf
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
      <div ref={containerRef} className="flex-1 overflow-auto bg-ink-100 dark:bg-ink-900">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-ink-500">加载中...</div>
          </div>
        )}
      </div>
    </div>
  );
}
