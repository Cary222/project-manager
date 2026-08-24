/**
 * ImageArtifact - 图片预览
 * 支持 Data URI 和 URL
 */

'use client';

import { useState } from 'react';
import type { Artifact } from '../../ai-workspace/types';
import { isDataUri } from '../../ai-workspace/utils/attachment-utils';

interface ImageArtifactProps {
  artifact: Artifact;
}

export function ImageArtifact({ artifact }: ImageArtifactProps) {
  const [error, setError] = useState(false);

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

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700">{artifact.filename}</span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600">
            {artifact.mimeType.split('/')[1]}
          </span>
        </div>
        <button
          onClick={handleDownload}
          className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 hover:text-brand-700"
        >
          下载
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-ink-50 p-4">
        {error ? (
          <div className="text-center">
            <p className="text-sm text-danger-600">图片加载失败</p>
            <p className="mt-2 text-xs text-ink-500">{artifact.filename}</p>
          </div>
        ) : (
          <img
            src={artifact.content}
            alt={artifact.filename}
            onError={() => setError(true)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>
  );
}
