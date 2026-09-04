"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowDraft } from "@/features/ai/agents/work/workflows/weekly-report/state";

interface WorkflowRun {
  id: string;
  kind: string;
  workflowType: string;
  status: string;
  threadId: string | null;
  metadata: unknown;
  history: unknown;
  createdAt: string;
  updatedAt: string;
  conversationId?: string | null;
}

interface WorkflowSnapshot {
  threadId: string;
  status: string;
  interrupted: boolean;
  interruptPayload: unknown | null;
  reportId: string | null;
  error: string | null;
  workflowRunId: string | null;
  values?: {
    draft?: WorkflowDraft;
    status?: string;
    weekStart?: string;
    weekEnd?: string;
    history?: Array<{ timestamp: string; event: string; payload?: unknown }>;
    prefillTitle?: string;
    prefillContent?: string;
    prefillWeekStart?: string;
    prefillWeekEnd?: string;
  } | null;
}

interface WorkflowStatusCardProps {
  run: WorkflowRun;
  /** Triggered when user clicks "查看" — passes runId and conversationId */
  onDone?: (runId: string, conversationId?: string) => void;
  /** Triggered after delete — increments refresh key to reload list */
  onDeleted?: (runId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  collecting: "采集中",
  drafting: "生成中",
  waiting_review: "待审阅",
  revising: "修订中",
  outputting: "写入中",
  done: "已完成",
  cancelled: "已取消",
  running: "运行中",
  pending: "排队中",
  failed: "失败",
};

function statusBadgeClass(status: string): string {
  if (status === "done") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "cancelled" || status === "failed")
    return "bg-red-50 text-red-700 border-red-200";
  if (status === "waiting_review")
    return "bg-amber-50 text-amber-800 border-amber-200";
  if (
    status === "running" ||
    status === "collecting" ||
    status === "drafting" ||
    status === "revising" ||
    status === "outputting"
  )
    return "bg-brand-50 text-brand-800 border-brand-100";
  return "bg-ink-50 text-ink-600 border-ink-200";
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "cancelled" || status === "failed";
}

export function WorkflowStatusCard({ run, onDone, onDeleted }: WorkflowStatusCardProps) {
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/ai/workflows/${run.id}`);
      if (res.status === 404) {
        // Run row no longer in DB (cleanup / cache). Stop polling.
        if (fetchTimerRef.current) {
          clearInterval(fetchTimerRef.current);
          fetchTimerRef.current = null;
        }
        setError("工作流记录不存在");
        return;
      }
      if (res.ok) {
        const json = await res.json();
        const snap = json.data?.snapshot ?? null;
        setSnapshot(snap);
        // 注意：卡片视图不自动调 onDone，避免工作流完成后"查看列表"也被强制跳详情
        // 用户需要点"查看"按钮才会触发 onSelectRun 进入详情面板
      }
    } catch {
      setError("加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [run.id, onDone]);

  useEffect(() => {
    void fetchSnapshot();
    if (isTerminal(run.status)) return;

    fetchTimerRef.current = setInterval(() => {
      void fetchSnapshot();
    }, 5000);

    return () => {
      if (fetchTimerRef.current) {
        clearInterval(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [run.status, fetchSnapshot]);

  const status = snapshot?.status ?? run.status;
  const draft = snapshot?.values?.draft;
  const reportId = snapshot?.reportId ?? null;

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-ink-900">
              {workflowTypeLabel(run.workflowType)}
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
            >
              {!isTerminal(status) && (
                <span className="h-1 w-1 animate-pulse rounded-full bg-current opacity-60" />
              )}
              {STATUS_LABEL[status] ?? status}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-500">{formatDate(run.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onDone?.(run.id, run.conversationId ?? undefined)}
            className="rounded px-2 py-1 text-xs text-ink-500 transition-colors hover:bg-ink-100"
            title="查看详情"
          >
            查看
          </button>
          <button
            onClick={() => {
              if (window.confirm("确定删除该工作流记录？")) {
                void fetch(`/api/ai/workflows/${run.id}`, { method: "DELETE" }).then(() => onDeleted?.(run.id));
              }
            }}
            className="rounded px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
            title="删除"
          >
            删除
          </button>
          <button
            onClick={() => void fetchSnapshot()}
            disabled={isLoading}
            className="rounded p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600 disabled:opacity-50"
            title="刷新"
          >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={isLoading ? "animate-spin" : ""}
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Done / Cancelled: show summary */}
      {isTerminal(status) && (
        <div className="px-4 pb-4">
          {reportId && (
            <p className="text-sm text-emerald-700">
              ✓ 周报已生成（ID: {reportId.slice(0, 12)}...）
            </p>
          )}
          {!reportId && status === "cancelled" && (
            <p className="text-sm text-ink-500">工作流已取消</p>
          )}
        </div>
      )}

      {/* Non-terminal: simple progress */}
      {!isTerminal(status) && (
        <div className="px-4 pb-4">
          {/* Draft preview (non-review) */}
          {draft && (draft.highlights || draft.tasks || draft.nextPlan) && (
            <div className="mt-3 space-y-2 rounded-lg border border-ink-100 bg-ink-50/50 p-3">
              <p className="text-xs font-medium text-ink-600">草稿预览</p>
              <div className="space-y-1.5 text-sm text-ink-700">
                {draft.highlights && draft.highlights.length > 0 && (
                  <div>
                    <span className="text-xs text-ink-500">本周重点：</span>
                    <ul className="ml-3 list-disc">
                      {draft.highlights.slice(0, 3).map((h, i) => (
                        <li key={i} className="line-clamp-1">{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {draft.tasks && draft.tasks.length > 0 && (
                  <div>
                    <span className="text-xs text-ink-500">完成任务：</span>
                    <span>{draft.tasks.length} 项</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pending schedule cancel */}
          {status === "pending" && (
            <button
              type="button"
              onClick={() =>
                void fetch(`/api/ai/workflows/${run.id}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "cancel" }),
                }).then(() => onDone?.(run.id))
              }
              className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              取消预约
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function workflowTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    weekly_report: "周报生成",
    "project-progress": "项目进展汇总",
    project_summary: "项目摘要",
    coding: "Coding Task",
  };
  return labels[type] ?? type;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
