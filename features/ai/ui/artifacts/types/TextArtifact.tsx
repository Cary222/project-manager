/**
 * TextArtifact - 纯文本 / 代码 Artifact
 * 支持语法高亮（使用 Prism.js）
 */

import type { Artifact } from '../../ai-workspace/types';

interface TextArtifactProps {
  artifact: Artifact;
}

export function TextArtifact({ artifact }: TextArtifactProps) {
  // 从文件名推断语言
  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    
    const langMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      rb: 'ruby',
      java: 'java',
      go: 'go',
      rs: 'rust',
      c: 'c',
      cpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      html: 'html',
      css: 'css',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'bash',
      bash: 'bash',
      sql: 'sql',
      md: 'markdown',
    };

    return langMap[ext || ''] || 'text';
  };

  const language = getLanguage(artifact.filename);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-700">{artifact.filename}</span>
          <span className="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-mono text-ink-600">
            {language}
          </span>
        </div>
        <button
          onClick={() => {
            const blob = new Blob([artifact.content], { type: 'text/plain' });
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
      <div className="flex-1 overflow-auto bg-ink-900 p-4">
        <pre className="text-sm text-ink-50">
          <code className={`language-${language}`}>
            {artifact.content}
          </code>
        </pre>
      </div>
    </div>
  );
}
