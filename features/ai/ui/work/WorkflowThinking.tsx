"use client";

import { useEffect, useRef, useState } from "react";

interface HistoryEntry {
  timestamp: string;
  event: string;
  payload?: unknown;
}

interface WorkflowThinkingProps {
  history: HistoryEntry[];
  /** 当前状态，用于显示当前活跃节点 */
  currentStatus: string;
}

const NODE_STEPS = [
  { key: "workflow_start", label: "启动工作流", icon: "🚀" },
  { key: "graph_invoke", label: "初始化图", icon: "⚙️" },
  { key: "collect_data", label: "采集数据", icon: "📋" },
  { key: "collect_data_error", label: "采集失败", icon: "❌", isError: true },
  { key: "draft_ready", label: "生成草稿", icon: "✍️" },
  { key: "draft_partial", label: "草稿部分生成", icon: "⚠️" },
  { key: "draft_error", label: "草稿生成失败", icon: "❌", isError: true },
  { key: "review_cancel", label: "取消审阅", icon: "🚫" },
  { key: "review_revise", label: "请求修改", icon: "🔄" },
  { key: "review_approve", label: "批准通过", icon: "✅" },
  { key: "revise_skip", label: "跳过修订", icon: "⏭️" },
  { key: "revise_done", label: "修订完成", icon: "🔄" },
  { key: "revise_error", label: "修订失败", icon: "❌", isError: true },
  { key: "output_idempotent_run", label: "写入周报（已存在）", icon: "💾" },
  { key: "output_done", label: "周报已落盘", icon: "📝" },
  { key: "output_error", label: "写入失败", icon: "❌", isError: true },
  { key: "interrupted", label: "等待审批", icon: "⏸️" },
  { key: "resume", label: "处理审批", icon: "🔁" },
  { key: "workflow_finish", label: "工作流结束", icon: "🏁" },
];

const STATUS_STEPS: Record<string, string> = {
  collecting: "正在采集本周数据…",
  drafting: "正在生成周报草稿…",
  waiting_review: "等待您的审批…",
  revising: "正在根据意见修订…",
  outputting: "正在写入周报…",
  done: "周报已生成完毕",
  cancelled: "工作流已取消",
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function getStepConfig(event: string) {
  return NODE_STEPS.find((s) => event.startsWith(s.key)) ?? {
    key: event,
    label: event,
    icon: "📌",
    isError: false,
  };
}

function formatPayload(event: string, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  switch (true) {
    case event.startsWith("collect_data"):
      return `采集到 ${p.tickets ?? 0} 条工单、${p.notes ?? 0} 条笔记、${p.conversations ?? 0} 条对话`;
    case event === "draft_ready":
      return `重点 ${p.highlights ?? 0} 条，任务 ${p.tasks ?? 0} 条`;
    case event === "review_revise":
      return p.feedback ? `意见：${String(p.feedback).slice(0, 60)}…` : null;
    case event === "review_cancel":
      return p.feedback ? `原因：${String(p.feedback).slice(0, 60)}` : "用户主动取消";
    case event === "output_done":
      return `周报 ID: ${p.reportId ?? "—"}`;
    case event === "output_idempotent_run":
      return `复用已有周报 ID: ${p.reportId ?? "—"}`;
    case event === "workflow_finish":
      return `最终状态：${p.status ?? ""}`;
    case event.includes("error"):
      return p.message ? String(p.message).slice(0, 80) : null;
    default:
      return null;
  }
}

export function WorkflowThinking({ history, currentStatus }: WorkflowThinkingProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  // Auto-scroll to bottom when new entries appear
  useEffect(() => {
    if (history.length > visibleCount) {
      setVisibleCount(history.length);
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [history.length, visibleCount]);

  const isRunning = !["done", "cancelled"].includes(currentStatus);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink-900">AI 思考过程</h2>
        {isRunning && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
            {STATUS_STEPS[currentStatus] ?? "处理中…"}
          </span>
        )}
        {!isRunning && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            ✓ 完成
          </span>
        )}
      </div>

      {/* Thinking Stream */}
      <div className="flex-1 overflow-y-auto space-y-1 pr-2">
        {history.map((entry, i) => {
          const step = getStepConfig(entry.event);
          const detail = formatPayload(entry.event, entry.payload);
          const isLast = i === history.length - 1;
          const isActive = isLast && isRunning;

          return (
            <div
              key={`${entry.event}-${i}`}
              className={`flex gap-3 rounded-lg p-3 transition-all duration-300 ${
                isActive
                  ? "bg-brand-50 border border-brand-200"
                  : step.isError
                  ? "bg-red-50 border border-red-100"
                  : "bg-white border border-transparent hover:bg-ink-50"
              }`}
            >
              {/* Icon + connector */}
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
                    isActive
                      ? "bg-brand-500 text-white shadow-sm"
                      : step.isError
                      ? "bg-red-100 text-red-600"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {step.icon}
                </span>
                {i < history.length - 1 && (
                  <div className="mt-1 h-4 w-px bg-ink-200" />
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-sm font-medium ${
                      isActive
                        ? "text-brand-800"
                        : step.isError
                        ? "text-red-700"
                        : "text-ink-800"
                    }`}
                  >
                    {step.label}
                  </span>
                  <span className="text-xs text-ink-400">{formatTime(entry.timestamp)}</span>
                </div>
                {detail && (
                  <p className="mt-1 text-xs text-ink-500 leading-relaxed">{detail}</p>
                )}
                {isActive && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand-400 [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand-400 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand-400 [animation-delay:300ms]" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
