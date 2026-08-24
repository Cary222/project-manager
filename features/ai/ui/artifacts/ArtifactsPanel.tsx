/**
 * ArtifactsPanel - 右侧 Artifacts 预览面板
 * 
 * 根据 mimeType 动态渲染不同类型的 Artifact
 */

'use client';

import { X } from 'lucide-react';
import { useArtifactStore } from './artifact-store';
import { TextArtifact } from './types/TextArtifact';
import { MarkdownArtifact } from './types/MarkdownArtifact';
import { ImageArtifact } from './types/ImageArtifact';
import { HtmlArtifact } from './types/HtmlArtifact';
import { SvgArtifact } from './types/SvgArtifact';
import { PdfArtifact } from './types/PdfArtifact';
import { ExcelArtifact } from './types/ExcelArtifact';
import { DocxArtifact } from './types/DocxArtifact';
import type { Artifact } from '../ai-workspace/types';

interface ArtifactsPanelProps {
  collapsed: boolean;
  overlay: boolean;
  onClose: () => void;
}

function renderArtifact(artifact: Artifact) {
  const { mimeType } = artifact;
  
  // Text
  if (mimeType === 'text/plain' || mimeType === 'application/json' || mimeType === 'text/csv') {
    return <TextArtifact artifact={artifact} />;
  }
  
  // Markdown
  if (mimeType === 'text/markdown') {
    return <MarkdownArtifact artifact={artifact} />;
  }
  
  // Image
  if (mimeType.startsWith('image/')) {
    return <ImageArtifact artifact={artifact} />;
  }
  
  // HTML
  if (mimeType === 'text/html') {
    return <HtmlArtifact artifact={artifact} />;
  }
  
  // SVG
  if (mimeType === 'image/svg+xml') {
    return <SvgArtifact artifact={artifact} />;
  }
  
  // PDF
  if (mimeType === 'application/pdf') {
    return <PdfArtifact artifact={artifact} />;
  }
  
  // Excel
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    return <ExcelArtifact artifact={artifact} />;
  }
  
  // Word
  if (mimeType.includes('wordprocessing') || mimeType.includes('msword')) {
    return <DocxArtifact artifact={artifact} />;
  }
  
  // 默认：纯文本预览
  return (
    <div className="h-full p-4 overflow-auto bg-background">
      <div className="mb-2 text-xs text-ink-500 dark:text-ink-400">
        Unsupported MIME type: {mimeType}
      </div>
      <pre className="text-sm whitespace-pre-wrap break-words font-mono">
        {artifact.content.slice(0, 1000)}
        {artifact.content.length > 1000 && '\n\n... (truncated)'}
      </pre>
    </div>
  );
}

export function ArtifactsPanel({ collapsed, overlay, onClose }: ArtifactsPanelProps) {
  const artifacts = useArtifactStore(state => state.artifacts);
  const activeFilename = useArtifactStore(state => state.activeFilename);
  const setActive = useArtifactStore(state => state.setActive);
  
  if (collapsed) {
    return null;
  }
  
  const artifactList = Array.from(artifacts.entries());
  const activeArtifact = activeFilename ? artifacts.get(activeFilename) : artifactList[0]?.[1];
  
  return (
    <div 
      className={`
        h-full flex flex-col
        bg-ink-50 dark:bg-ink-900
        border-l border-ink-200 dark:border-ink-800
        ${overlay ? 'shadow-2xl' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink-200 dark:border-ink-800">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">
          Artifacts ({artifactList.length})
        </h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-ink-200 dark:hover:bg-ink-800 transition-colors"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      {/* Tabs */}
      {artifactList.length > 1 && (
        <div className="flex gap-1 px-2 py-2 border-b border-ink-200 dark:border-ink-800 overflow-x-auto">
          {artifactList.map(([filename]) => (
            <button
              key={filename}
              onClick={() => setActive(filename)}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
                transition-colors
                ${activeFilename === filename || (!activeFilename && filename === artifactList[0][0])
                  ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-900 dark:text-brand-100'
                  : 'text-ink-600 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800'
                }
              `}
            >
              {filename}
            </button>
          ))}
        </div>
      )}
      
      {/* Preview Area */}
      <div className="flex-1 overflow-hidden">
        {activeArtifact ? (
          renderArtifact(activeArtifact)
        ) : (
          <div className="flex items-center justify-center h-full text-ink-400 dark:text-ink-500">
            暂无 Artifacts
          </div>
        )}
      </div>
    </div>
  );
}
