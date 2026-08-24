/**
 * ExcelArtifact - Excel 表格预览渲染器
 * 使用 SheetJS (xlsx) 库的 sheet_to_html 方法渲染
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import type { Artifact } from '../../ai-workspace/types';
import { base64ToArrayBuffer, decodeBase64 } from '../utils/base64-decoder';

interface ExcelArtifactProps {
  artifact: Artifact;
}

interface SheetInfo {
  name: string;
  html: string;
}

export function ExcelArtifact({ artifact }: ExcelArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const renderExcel = async () => {
      const container = containerRef.current;
      if (!container || !artifact.content) return;

      setIsLoading(true);
      setError(null);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const XLSXModule = await import('xlsx') as any;
        const XLSXLib = XLSXModule.default || XLSXModule;

        const arrayBuffer = base64ToArrayBuffer(artifact.content);
        const workbook = XLSXLib.read(arrayBuffer, { type: 'array' });

        if (cancelled) return;

        const sheetsData: SheetInfo[] = workbook.SheetNames.map((sheetName: string) => {
          const worksheet = workbook.Sheets[sheetName];
          // 使用 sheet_to_html 获取带样式的 HTML
          const html = XLSXLib.utils.sheet_to_html(worksheet, {
            id: `sheet-${sheetName}`,
            editable: false,
          });
          return { name: sheetName, html };
        });

        setSheets(sheetsData);
        setActiveSheet(0);
        setIsLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error rendering Excel:', err);
        setError(err instanceof Error ? err.message : 'Excel 加载失败');
        setIsLoading(false);
      }
    };

    renderExcel();

    return () => {
      cancelled = true;
    };
  }, [artifact.content]);

  const handleDownload = () => {
    const bytes = decodeBase64(artifact.content);
    const ext = artifact.filename.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
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
            <div className="font-medium text-danger-900 dark:text-danger-100">Excel 加载失败</div>
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
            excel
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

      {/* Sheet Tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-1 border-b border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-4 py-1">
          {sheets.map((sheet, index) => (
            <button
              key={index}
              onClick={() => setActiveSheet(index)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                activeSheet === index
                  ? 'bg-white dark:bg-ink-800 text-brand-700 dark:text-brand-400 shadow-sm'
                  : 'text-ink-600 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto bg-white dark:bg-ink-950 p-4">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm text-ink-500">加载中...</div>
          </div>
        )}

        {!isLoading && sheets[activeSheet] && (
          <div
            ref={containerRef}
            className="excel-table-wrapper [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:text-ink-700 dark:[&_table]:text-ink-300 [&_table_td]:border [&_table_td]:border-ink-200 dark:[&_table_td]:border-ink-700 [&_table_td]:px-3 [&_table_td]:py-2 [&_table_td]:text-left [&_table_th]:border [&_table_th]:border-ink-200 dark:[&_table_th]:border-ink-700 [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:text-left [&_table_th]:font-semibold [&_table_th]:bg-ink-100 dark:[&_table_th]:bg-ink-800 [&_table_tbody_tr:nth-child(even)]:bg-ink-50 dark:[&_table_tbody_tr:nth-child(even)]:bg-ink-900/50"
            dangerouslySetInnerHTML={{ __html: sheets[activeSheet].html }}
          />
        )}
      </div>
    </div>
  );
}
