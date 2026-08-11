"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkflowLauncher } from "./WorkflowLauncher";
import { WorkflowStatusCard } from "./WorkflowStatusCard";

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
}

interface WorkModePanelProps {
  /** Callback when switching back to conversation mode */
  onSwitchToConversation?: () => void;
  /** Callback when user clicks "查看" on a run */
  onSelectRun?: (runId: string, conversationId?: string) => void;
  /** Callback when user wants to start a conversation */
  onStartConversation?: () => void;
}

export function WorkModePanel({ onSwitchToConversation, onSelectRun, onStartConversation }: WorkModePanelProps) {
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/ai/workflows?kind=RUN&limit=20");
      if (res.ok) {
        const json = await res.json();
        setWorkflowRuns(json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns, refreshKey]);

  // 立即生成后：刷新列表 + 自动展开对应工作流的详情面板（不切到对话页）
  const handleWorkflowLaunched = useCallback((runId: string, _conversationId?: string) => {
    setRefreshKey((k) => k + 1);
    onSelectRun?.(runId, _conversationId);
  }, [onSelectRun]);

  const handleDeleted = useCallback((runId: string) => {
    setRefreshKey((k) => k + 1);
  }, []);

  const allRuns = workflowRuns.slice(0, 10);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-ink-900">工作模式</p>
            <p className="text-xs text-ink-500">发起和管理任务工作流</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Workflow Launcher */}
        <section className="mb-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
            发起工作流
          </h2>
          <WorkflowLauncher
            onWorkflowLaunched={handleWorkflowLaunched}
            onLaunched={handleWorkflowLaunched}
          />
        </section>

        {/* All Runs */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
            工作流列表
          </h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-lg border border-ink-200 bg-white p-4"
                >
                  <div className="h-4 w-24 rounded bg-ink-200" />
                  <div className="mt-2 h-3 w-32 rounded bg-ink-100" />
                </div>
              ))}
            </div>
          ) : allRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-300 p-8 text-center">
              <p className="text-sm text-ink-500">暂无工作流记录</p>
              <p className="mt-1 text-xs text-ink-400">发起一个工作流开始体验</p>
            </div>
          ) : (
            <div className="space-y-4">
              {allRuns.map((run) => (
                <WorkflowStatusCard
                  key={run.id}
                  run={run}
                  onDone={(runId) => onSelectRun?.(runId)}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
