/**
 * QueryTicketRenderer - query_ticket 工具渲染器
 * 
 * 渲染工单查询结果
 */

import type { ToolCallRendererProps } from './ToolCallRegistry';
import { Ticket } from 'lucide-react';

const STATUS_COLORS = {
  OPEN: 'bg-brand-100 text-brand-700',
  IN_PROGRESS: 'bg-warning-100 text-warning-700',
  BLOCKED: 'bg-danger-100 text-danger-700',
  RESOLVED: 'bg-success-100 text-success-700',
  CLOSED: 'bg-ink-100 text-ink-600',
} as const;

export function QueryTicketRenderer({
  output,
  status,
  error,
}: ToolCallRendererProps) {
  if (status === 'error' || error) {
    return (
      <div className="rounded-lg border border-danger-200 bg-danger-50 p-3">
        <div className="flex items-center gap-2 text-sm text-danger-700">
          <Ticket className="h-4 w-4" />
          <span>Failed to query ticket: {error}</span>
        </div>
      </div>
    );
  }

  if (!output?.success || !output?.data) {
    return null;
  }

  const ticket = output.data;
  const statusColor = STATUS_COLORS[ticket.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.OPEN;

  return (
    <div className="rounded-lg border border-brand-200 bg-white p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-100 pb-2">
        <div className="flex items-center gap-2">
          <Ticket className="h-5 w-5 text-brand-600" />
          <span className="text-sm font-mono text-ink-600">
            #{ticket.ticketNo}
          </span>
          <h3 className="text-sm font-semibold text-ink-900">
            {ticket.title}
          </h3>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-medium ${statusColor}`}>
          {ticket.status}
        </span>
      </div>

      {/* Content */}
      <div className="mt-3 space-y-2">
        {ticket.description && (
          <p className="text-sm text-ink-700 line-clamp-3">
            {ticket.description}
          </p>
        )}

        {/* Meta */}
        <div className="flex gap-4 text-xs text-ink-600">
          {ticket.priority && <span>Priority: {ticket.priority}</span>}
          {ticket.progress !== undefined && (
            <span>Progress: {ticket.progress}%</span>
          )}
          {ticket.assignees && ticket.assignees.length > 0 && (
            <span>
              Assigned to: {ticket.assignees.map((a: any) => a.user?.name).join(', ')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
