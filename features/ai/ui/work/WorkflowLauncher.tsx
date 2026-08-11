"use client";

import { useCallback, useState } from "react";

interface WorkflowLauncherProps {
  /**
   * Fired when a workflow is successfully launched.
   * Default: triggers a refresh without navigation.
   */
  onWorkflowLaunched?: (runId: string, conversationId?: string) => void;
  /**
   * @deprecated Use onWorkflowLaunched instead. Kept for backward compat.
   */
  onLaunched?: (runId: string, conversationId?: string) => void;
}

type WorkflowType = "weekly_report";

interface LaunchResult {
  runId: string;
  status: string;
  threadId?: string;
  conversationId?: string;
}

export function WorkflowLauncher({ onWorkflowLaunched, onLaunched }: WorkflowLauncherProps) {
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [conflictRunId, setConflictRunId] = useState<string | null>(null);

  const launchWorkflow = useCallback(
    async (type: WorkflowType, force = false) => {
      setIsLaunching(true);
      setError(null);
      setResult(null);
      setConflictRunId(null);

      try {
        const body: Record<string, unknown> = { workflowType: type };

        // For weekly_report, auto-calculate current week
        if (type === "weekly_report") {
          const now = new Date();
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          monday.setHours(0, 0, 0, 0);

          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);
          sunday.setHours(23, 59, 59, 999);

          body.weekStart = monday.toISOString();
          body.weekEnd = sunday.toISOString();
        }

        if (force) {
          body.forceRestart = true;
        }

        const res = await fetch("/api/ai/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const json = await res.json();

        if (!res.ok || json.error) {
          setError(json.error ?? "启动失败");
          return;
        }

        setResult(json.data);
        if (json.data.skipped) {
          setConflictRunId(json.data.existingRunId ?? null);
          setError("已有相同类型的工作流正在运行");
          setResult(null);
          return;
        }
        setResult(json.data);
        onWorkflowLaunched?.(json.data.runId, json.data.conversationId);
        onLaunched?.(json.data.runId, json.data.conversationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
      } finally {
        setIsLaunching(false);
      }
    },
    [onWorkflowLaunched, onLaunched]
  );

  const handleForceRestart = useCallback(() => {
    void launchWorkflow("weekly_report", true);
  }, [launchWorkflow]);

  const handleScheduleWeeklyReport = useCallback(async () => {
    setIsLaunching(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/ai/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowType: "weekly_report", scheduleOnly: true }),
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error ?? "预约失败");
        return;
      }

        setResult({
        runId: json.data.scheduleId,
        status: "scheduled",
        conversationId: json.data.conversationId,
      });
      onWorkflowLaunched?.(json.data.scheduleId, json.data.conversationId);
      onLaunched?.(json.data.scheduleId, json.data.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setIsLaunching(false);
    }
  }, [onLaunched]);

  if (result) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 text-emerald-700">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm font-medium">
            {result.status === "scheduled" ? "已预约周报自动生成" : "工作流已启动"}
          </span>
        </div>
        <p className="mt-1 text-xs text-emerald-600">
          Run ID: {result.runId}
        </p>
        <button
          onClick={() => setResult(null)}
          className="mt-2 text-xs text-emerald-700 underline hover:no-underline"
        >
          启动新的工作流
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Weekly Report Card */}
      <div className="group rounded-xl border border-ink-200 bg-white p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-ink-900">生成周报</h3>
              <p className="mt-0.5 text-sm text-ink-500">
                自动汇总本周工单、提交和进度，生成结构化周报
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void launchWorkflow("weekly_report")}
              disabled={isLaunching}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {isLaunching ? "启动中..." : "立即生成"}
            </button>
            <button
              onClick={() => void handleScheduleWeeklyReport()}
              disabled={isLaunching}
              className="rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
            >
              预约
            </button>
          </div>
        </div>
      </div>

      {/* Future workflows placeholder */}
      <div className="rounded-xl border border-dashed border-ink-200 p-4 text-center">
        <p className="text-sm text-ink-400">更多工作流模板正在开发中...</p>
      </div>

      {error && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          {conflictRunId && (
            <button
              onClick={handleForceRestart}
              disabled={isLaunching}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-4.5" />
              </svg>
              强制重新开始
            </button>
          )}
        </div>
      )}
    </div>
  );
}
