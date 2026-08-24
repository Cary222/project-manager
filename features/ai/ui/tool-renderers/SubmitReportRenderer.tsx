/**
 * SubmitReportRenderer - submit_report 工具渲染器
 * 
 * 渲染周报提交结果
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { FileText } from 'lucide-react';

export function SubmitReportRenderer({
  output,
  status,
  error,
}: ToolCallRendererProps) {
  if (status === 'error' || error) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
        <div className="flex items-center gap-2 text-sm text-danger-700">
          <FileText className="h-4 w-4" />
          <span>Failed to submit report: {error}</span>
        </div>
      </div>
    );
  }

  if (!output?.success) {
    return null;
  }

  const isUpdate = output.isUpdate;
  const report = output.data;

  return (
    <div className="rounded-lg border border-success-200 bg-success-50 p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-success-700" />
        <span className="text-sm font-medium text-success-700">
          {isUpdate ? 'Weekly report updated' : 'Weekly report created'}
        </span>
      </div>

      {/* Details */}
      {report && (
        <div className="mt-2 space-y-1 text-xs text-success-600">
          {report.title && <div>Title: {report.title}</div>}
          {report.weekStart && (
            <div>Week: {new Date(report.weekStart).toLocaleDateString()}</div>
          )}
        </div>
      )}

      {output.message && (
        <p className="mt-2 text-xs text-success-600">{output.message}</p>
      )}
    </div>
  );
}
