"use client";

import { useCallback, useState } from "react";
import type { WorkRoute } from "@/features/ai/agents/work/runtime/work-run-ref";

export type CodingCommand = "goal" | "plan" | "audit" | "reach" | "websearch";

interface WorkflowLauncherProps {
  /**
   * Fired when a workflow is successfully launched.
   */
  onWorkflowLaunched?: (
    runId: string,
    conversationId?: string,
    kind?: WorkRoute,
  ) => void;
  /**
   * @deprecated Use onWorkflowLaunched instead. Kept for backward compat.
   */
  onLaunched?: (runId: string, conversationId?: string) => void;
  /**
   * Quick fill goal input in the parent dashboard.
   */
  onSelectPresetGoal?: (
    goal: string,
    command?: CodingCommand,
    targetRoute?: WorkRoute,
  ) => void;
  /**
   * Start meeting workflow right inside Work Mode without leaving.
   */
  onStartMeetingWorkflow?: () => void;
}

type WorkflowType = "weekly_report" | "project-progress";

interface LaunchResult {
  runId: string;
  status: string;
  kind?: WorkRoute;
  title?: string;
  threadId?: string;
  conversationId?: string;
}

export function WorkflowLauncher({
  onWorkflowLaunched,
  onLaunched,
  onSelectPresetGoal,
  onStartMeetingWorkflow,
}: WorkflowLauncherProps) {
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

        if (json.data.skipped) {
          setConflictRunId(json.data.existingRunId ?? null);
          setError("已有相同类型的工作流正在运行");
          setResult(null);
          return;
        }

        const kind: WorkRoute =
          type === "project-progress" ? "project_progress" : "weekly_report";
        const title = type === "project-progress" ? "项目进展汇总" : "周报生成";

        setResult({
          runId: json.data.runId,
          status: json.data.status ?? "running",
          kind,
          title,
          conversationId: json.data.conversationId,
        });

        onWorkflowLaunched?.(json.data.runId, json.data.conversationId, kind);
        onLaunched?.(json.data.runId, json.data.conversationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "网络错误");
      } finally {
        setIsLaunching(false);
      }
    },
    [onWorkflowLaunched, onLaunched],
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
        body: JSON.stringify({
          workflowType: "weekly_report",
          scheduleOnly: true,
        }),
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error ?? "预约失败");
        return;
      }

      setResult({
        runId: json.data.scheduleId,
        status: "scheduled",
        kind: "weekly_report",
        title: "周报预约",
        conversationId: json.data.conversationId,
      });
      onWorkflowLaunched?.(
        json.data.scheduleId,
        json.data.conversationId,
        "weekly_report",
      );
      onLaunched?.(json.data.scheduleId, json.data.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setIsLaunching(false);
    }
  }, [onWorkflowLaunched, onLaunched]);

  return (
    <div className="space-y-3">
      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              ✓{" "}
              {result.status === "scheduled"
                ? "已预约周报自动生成"
                : `${result.title || "工作流"}已启动`}
            </span>
            <button
              onClick={() => setResult(null)}
              className="text-xs text-emerald-600 hover:text-emerald-800"
            >
              关闭
            </button>
          </div>
          <p className="mt-1 font-mono text-[11px] text-emerald-600">
            ID: {result.runId}
          </p>
        </div>
      )}

      {error && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <p>{error}</p>
          {conflictRunId && (
            <button
              onClick={handleForceRestart}
              disabled={isLaunching}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-2.5 py-1.5 font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              强制重新开始
            </button>
          )}
        </div>
      )}

      {/* 1. 生成周报 (weekly_report) */}
      <div className="rounded-xl border border-ink-200 bg-white p-3.5 transition hover:border-ink-300 hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <svg
                width="16"
                height="16"
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
              <p className="text-sm font-semibold text-ink-900">生成周报</p>
              <p className="mt-0.5 text-xs text-ink-500">
                自动汇总本周工单、提交和进度
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {onSelectPresetGoal && (
            <button
              type="button"
              onClick={() =>
                onSelectPresetGoal(
                  "生成本周工作周报",
                  undefined,
                  "weekly_report",
                )
              }
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-50"
            >
              填入目标
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleScheduleWeeklyReport()}
            disabled={isLaunching}
            className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-50 disabled:opacity-50"
          >
            预约
          </button>
          <button
            type="button"
            onClick={() => void launchWorkflow("weekly_report")}
            disabled={isLaunching}
            className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {isLaunching ? "启动中…" : "立即生成"}
          </button>
        </div>
      </div>

      {/* 2. 项目进展汇总 (project_progress) */}
      <div className="rounded-xl border border-ink-200 bg-white p-3.5 transition hover:border-ink-300 hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">项目进展汇总</p>
              <p className="mt-0.5 text-xs text-ink-500">
                聚合工单与 Git 提交，输出进展报告
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {onSelectPresetGoal && (
            <button
              type="button"
              onClick={() =>
                onSelectPresetGoal(
                  "汇总当前项目进展报告",
                  undefined,
                  "project_progress",
                )
              }
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-50"
            >
              填入目标
            </button>
          )}
          <button
            type="button"
            onClick={() => void launchWorkflow("project-progress")}
            disabled={isLaunching}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {isLaunching ? "汇总中…" : "立即汇总"}
          </button>
        </div>
      </div>

      {/* 3. 会议纪要 (meeting_minutes) */}
      <div className="rounded-xl border border-ink-200 bg-white p-3.5 transition hover:border-ink-300 hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">会议纪要</p>
              <p className="mt-0.5 text-xs text-ink-500">
                上传会议录音，智能转写与提取摘要
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {onSelectPresetGoal && (
            <button
              type="button"
              onClick={() =>
                onSelectPresetGoal(
                  "整理最近的项目会议纪要",
                  undefined,
                  "meeting_minutes",
                )
              }
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-50"
            >
              填入目标
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartMeetingWorkflow?.()}
            className="rounded-lg bg-purple-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-purple-700"
          >
            开始生成纪要
          </button>
        </div>
      </div>

      {/* 4. Coding Task (coding) */}
      <div className="rounded-xl border border-ink-200 bg-white p-3.5 transition hover:border-ink-300 hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">Coding Task</p>
              <p className="mt-0.5 text-xs text-ink-500">
                创建独立 Pi 会话执行代码开发与审查
              </p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {onSelectPresetGoal && (
            <button
              type="button"
              onClick={() =>
                onSelectPresetGoal(
                  "帮我修复最近的工单 Bug 并执行代码检查",
                  "goal",
                  "coding",
                )
              }
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-50"
            >
              填入目标
            </button>
          )}
          <a
            href="/ai-workspace"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700"
          >
            打开 Workspace
          </a>
        </div>
      </div>
    </div>
  );
}
