/**
 * GenericArtifact - 通用 Artifact 下载
 * 用于不支持预览的文件类型
 */

'use client';

import type { Artifact } from '../../ai-workspace/types';
import { formatFileSize, isDataUri } from '../../ai-workspace/utils/attachment-utils';

interface GenericArtifactProps {
  artifact: Artifact;
}

export function GenericArtifact({ artifact }: GenericArtifactProps) {
  const handleDownload = () => {
    if (isDataUri(artifact.content)) {
      // Data URI 直接下载
      const a = document.createElement('a');
      a.href = artifact.content;
      a.download = artifact.filename;
      a.click();
    } else {
      // URL 需要 fetch 后下载
      fetch(artifact.content)
        .then((res) => res.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename;
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch((err) => {
          console.error('Download failed:', err);
        });
    }
  };

  // 计算文件大小
  const fileSize = isDataUri(artifact.content)
    ? Math.floor((artifact.content.length - artifact.content.indexOf(',') - 1) * 0.75)
    : artifact.content.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700">{artifact.filename}</span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600">
            {artifact.mimeType.split('/')[1] || 'file'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center bg-ink-50">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-brand-100">
            <svg
              className="h-10 w-10 text-brand-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>

          <p className="mb-2 text-sm font-medium text-ink-900">{artifact.filename}</p>
          <p className="mb-4 text-xs text-ink-500">
            {artifact.mimeType} • {formatFileSize(fileSize)}
          </p>

          <button
            onClick={handleDownload}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            下载文件
          </button>

          <p className="mt-4 text-xs text-ink-400">此文件类型不支持在线预览</p>
        </div>
      </div>
    </div>
  );
}
