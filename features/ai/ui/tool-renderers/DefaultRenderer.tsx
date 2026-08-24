/**
 * DefaultRenderer - 通用 Fallback 渲染器
 * 
 * 用于未注册工具的默认展示
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';

export function DefaultRenderer({
  toolName,
  input,
  output,
  status,
  error,
}: ToolCallRendererProps) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      {/* 工具名 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground">
          {toolName}
        </span>
        {status === 'pending' && (
          <span className="text-xs text-ink-600">Running...</span>
        )}
        {status === 'success' && (
          <span className="text-xs text-success-600">✓ Success</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-danger-600">✗ Error</span>
        )}
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="mb-2 rounded bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* 输入参数 */}
      {Object.keys(input).length > 0 && (
        <details className="mb-2">
          <summary className="cursor-pointer text-xs text-ink-600">
            Input ({Object.keys(input).length} params)
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}

      {/* 输出结果 */}
      {output && status === 'success' && (
        <details open>
          <summary className="cursor-pointer text-xs text-ink-600">
            Output
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
            {typeof output === 'string'
              ? output
              : JSON.stringify(output, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
