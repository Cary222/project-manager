"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkflowThinking } from "./WorkflowThinking";
import { ChatReviewPanel } from "./ChatReviewPanel";
import type { ReviewMessage } from "./ChatReviewPanel";
import type { WorkflowDraft } from "@/features/ai/agents/work/workflows/weekly-report/state";

interface WorkflowHistoryEntry {
  timestamp: string;
  event: string;
  payload?: unknown;
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
    draft?: WorkflowDraft | null;
    status?: string;
    weekStart?: string;
    weekEnd?: string;
    history?: WorkflowHistoryEntry[];
    prefillTitle?: string;
    prefillContent?: string;
    prefillWeekStart?: string;
    prefillWeekEnd?: string;
    prefillProjectIds?: string[];
  } | null;
}

interface WorkflowStatusProps {
  runId: string;
  threadId?: string | null;
  initialSnapshot?: WorkflowSnapshot | null;
  onDone?: (runId: string, snapshot: WorkflowSnapshot) => void;
  onApproved?: (runId: string, reportId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  collecting: "采集中",
  drafting: "生成草稿中",
  waiting_review: "待审阅",
  revising: "修订中",
  outputting: "写入周报中",
  done: "已完成",
  cancelled: "已取消",
  running: "运行中",
  pending: "排队中",
  error: "出错",
};

function statusBadgeClass(status: string): string {
  if (status === "done") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "cancelled" || status === "error")
    return "bg-red-50 text-red-700 border-red-200";
  if (status === "waiting_review")
    return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-brand-50 text-brand-800 border-brand-100";
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "cancelled" || status === "error";
}

function extractDraft(snapshot: WorkflowSnapshot | null): WorkflowDraft | null {
  if (!snapshot) return null;
  const fromValues = snapshot.values?.draft;
  if (fromValues) return fromValues as WorkflowDraft;
  const payload = snapshot.interruptPayload;
  if (payload && typeof payload === "object" && "draft" in payload) {
    return (payload as { draft: WorkflowDraft }).draft ?? null;
  }
  return null;
}

function extractReviewMessages(
  history: WorkflowHistoryEntry[] = []
): ReviewMessage[] {
  const messages: ReviewMessage[] = [];
  for (const h of history) {
    if (h.event === "review_revise" && h.payload && typeof h.payload === "object") {
      const p = h.payload as Record<string, unknown>;
      if (typeof p.message === "string" && p.message) {
        messages.push({
          id: `user-${h.timestamp}`,
          role: "user",
          content: p.message as string,
          timestamp: h.timestamp,
        });
      }
    }
  }
  return messages;
}

export function WorkflowStatus({
  runId,
  threadId,
  initialSnapshot = null,
  onDone,
  onApproved,
}: WorkflowStatusProps) {
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(
    initialSnapshot ?? null
  );
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 记录已经触发过 onDone 的状态 — 只在非 terminal → terminal 状态转换时通知一次
  // 避免轮询已 terminal 的快照时反复触发跳转
  const notifiedStatusRef = useRef<string | null>(null);

  // Stop the polling timer. Forward-declared so `refresh` can call it on 404.
  const stopRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/workflows/${runId}`);
      const json = (await res.json()) as {
        data: { snapshot: WorkflowSnapshot | null } | null;
        error: string | null;
      };
      if (!res.ok || json.error) {
        // 404 means the run is gone (DB cleared / never existed / browser cached stale runId).
        // Stop polling so we don't spam 404 forever.
        if (res.status === 404) {
          stopRefresh();
          setError("工作流记录不存在，可能已被清理");
          return;
        }
        setError(json.error ?? "加载失败");
        return;
      }
      const next = json.data?.snapshot ?? null;
      setSnapshot(next);
      // 只在状态从非 terminal 转换到 terminal 的那一刻调用 onDone 一次
      if (next && isTerminal(next.status) && notifiedStatusRef.current !== next.status) {
        notifiedStatusRef.current = next.status;
        stopRefresh();
        onDone?.(runId, next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, [runId, onDone, stopRefresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const status = snapshot?.status ?? "pending";
    if (isTerminal(status)) return;
    refreshTimerRef.current = setInterval(() => { void refresh(); }, 5000);
    return () => stopRefresh();
  }, [snapshot?.status, refresh, stopRefresh]);

  const status = snapshot?.status ?? "pending";
  const draft = extractDraft(snapshot);
  const history = snapshot?.values?.history ?? [];
  const isWaitingReview = status === "waiting_review";

  // Cancelling stops polling; parent detects status=dancelled via polling and
  // calls onDone(null) or similar to dismiss the panel.
  const handleCancelled = useCallback(() => {
    stopRefresh();
    // Stop here — the polling interval will clear because isTerminal("cancelled")
    // triggers stopRefresh() inside refresh().
    // Parent should clean up by removing this component from the DOM.
  }, [stopRefresh]);

  return (
    <div className="flex h-full flex-col gap-4 pm-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">周报工作流</h3>
          <p className="mt-1 text-sm text-ink-500">Run · {runId.slice(0, 12)}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
        >
          {!isTerminal(status) && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-60" />
          )}
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Waiting review: full chat panel */}
      {isWaitingReview && (
        <div className="flex-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
          <ChatReviewPanel
            workflowRunId={runId}
            draft={draft}
            messages={extractReviewMessages(history)}
            onApproved={(reportId) => onApproved?.(runId, reportId)}
            onCancelled={handleCancelled}
          />
        </div>
      )}

      {/* Other statuses: thinking stream + draft preview */}
      {!isWaitingReview && (
        <>
          <div className="flex-1 overflow-hidden rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
            {loading && history.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="space-y-3 text-center">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                  <p className="text-sm text-ink-500">加载中…</p>
                </div>
              </div>
            ) : (
              <WorkflowThinking history={history} currentStatus={status} />
            )}
          </div>

          {(error || snapshot?.error) && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error ?? snapshot?.error}
            </p>
          )}

          {snapshot?.reportId && (
            <p className="text-sm text-emerald-700">
              ✓ 周报已生成（{snapshot.reportId.slice(0, 12)}...）
            </p>
          )}

          {draft && !isTerminal(status) && (
            <div className="rounded-lg border border-ink-200 bg-ink-100/60 p-3">
              <p className="mb-2 text-sm font-medium text-ink-800">草稿预览</p>
              <div className="space-y-1 text-sm text-ink-700">
                {draft.highlights?.slice(0, 2).map((h) => (
                  <p key={h} className="truncate">· {h}</p>
                ))}
                {draft.tasks?.slice(0, 2).map((t) => (
                  <p key={t} className="truncate">· {t}</p>
                ))}
                {(draft.highlights?.length ?? 0) > 2 && (
                  <p className="text-xs text-ink-400">
                    …还有 {(draft.highlights?.length ?? 0) - 2} 条重点
                  </p>
                )}
              </div>
            </div>
          )}

          {!isTerminal(status) && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={loading}
                onClick={() => void refresh()}
                className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600 transition-colors duration-200 hover:bg-ink-100"
              >
                {loading ? "刷新中…" : "刷新状态"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
