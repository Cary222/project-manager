"use client";

/**
 * AiThinkingStream — AI thinking process visualization (Code Agent style).
 *
 * Design Philosophy:
 * - "AI is working" not "Graph nodes executing"
 * - Steps appear one by one (log stream effect)
 * - Each step shows real-time elapsed timer when running
 * - Collapsed: single line summary "思考过程（4 步 · 1.2s）"
 * - Expanded: vertical step list with per-step detail on click
 *
 * Architecture:
 *   graph.stream() → Route → TimelineAdapter → TimelineStore → SSE → React
 *
 * The outer container (border, background, padding) is provided by AiResponsePanel.
 * This component only renders the steps list + collapsible summary.
 */

import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import type { TaskRecord, TaskCategory } from "@/features/ai/types";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 1000).toFixed(0)}s`;
}

// ─── Category Icons (Lucide-style SVG paths for consistency) ───────────────────

function CategoryIcon({ category }: { category: TaskCategory }) {
  const iconClass = "h-3.5 w-3.5";

  switch (category) {
    case "reason":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    case "tool":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
    case "workflow":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "system":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    case "human":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

// ─── Status Icons ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: TaskRecord["status"] }) {
  switch (status) {
    case "running":
      return (
        <ThinkingOrb state="working" size={20} />
      );
    case "success":
      return (
        <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      );
    case "error":
      return (
        <svg className="h-3.5 w-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case "warning":
      return (
        <svg className="h-3.5 w-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    default:
      return (
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />
        </span>
      );
  }
}

// ─── Step Row ─────────────────────────────────────────────────────────────────

function StepRow({
  task,
  isExpanded,
  onToggle,
  now,
  nextTask,
}: {
  task: TaskRecord;
  isExpanded: boolean;
  onToggle: () => void;
  now: number;
  nextTask?: TaskRecord;
}) {
  const isRunning = task.status === "running";
  const isPending = task.status === "pending";

  const duration = (() => {
    if (isPending) return undefined;
    if (isRunning) {
      return typeof task.startTime === "number" && task.startTime > 0
        ? Math.max(0, now - task.startTime)
        : undefined;
    }
    if (
      typeof task.endTime === "number" &&
      typeof task.startTime === "number" &&
      task.endTime >= task.startTime
    ) {
      return task.endTime - task.startTime;
    }
    if (
      typeof task.startTime === "number" &&
      nextTask &&
      typeof nextTask.startTime === "number" &&
      nextTask.startTime >= task.startTime
    ) {
      return nextTask.startTime - task.startTime;
    }
    return undefined;
  })();
  const hasDetail = Boolean(task.detail);
  const hasLogs = Array.isArray((task as any).logs) && (task as any).logs.length > 0;
  const isExpandable = hasDetail || hasLogs;

  return (
    <div className="group">
      <button
        type="button"
        onClick={isExpandable ? onToggle : undefined}
        disabled={!isExpandable}
        className={`flex w-full items-center gap-2.5 py-2 text-left transition-colors ${
          isExpandable ? "cursor-pointer hover:bg-brand-50/50" : "cursor-default"
        }`}
        aria-expanded={isExpandable ? isExpanded : undefined}
      >
        <span className={`flex-shrink-0 rounded-md p-1 transition-colors ${
          task.status === "running"
            ? "bg-brand-100 text-brand-600"
            : task.status === "success"
              ? "bg-emerald-50 text-emerald-600"
              : task.status === "error"
                ? "bg-red-50 text-red-600"
                : "bg-ink-100 text-ink-500"
        }`}>
          <CategoryIcon category={task.category} />
        </span>

        <span className="flex-shrink-0">
          <StatusIcon status={task.status} />
        </span>

        <span className={`flex-1 text-sm font-medium transition-colors ${
          task.status === "running"
            ? "text-brand-700"
            : task.status === "success"
              ? "text-ink-700"
              : task.status === "error"
                ? "text-red-600"
                : task.status === "warning"
                  ? "text-amber-600 line-through"
                  : "text-ink-500"
        }`}>
          {task.stepLabel}
        </span>

        {duration !== undefined && duration >= 0 && (
          <span className={`flex-shrink-0 font-mono text-xs tabular-nums transition-colors ${
            task.status === "running"
              ? "text-brand-500 font-medium"
              : "text-ink-400"
          }`}>
            {formatDuration(duration)}
          </span>
        )}

        {isExpandable && (
          <svg
            className={`h-3 w-3 flex-shrink-0 text-ink-400 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isExpanded && isExpandable && (
        <div className="ml-9 mb-2 rounded-lg border border-ink-200 bg-white px-3 py-2.5 shadow-sm">
          {hasDetail && (
            <p className="text-xs leading-relaxed text-ink-600">
              {task.detail}
            </p>
          )}

          {hasLogs && (
            <div className="mt-2 space-y-1.5 border-t border-ink-100 pt-2">
              {(task as any).logs.map((log: any, i: number) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span className={`flex-shrink-0 font-medium ${
                    log.role === "assistant" ? "text-brand-500" : "text-ink-400"
                  }`}>
                    {log.role === "assistant" ? "AI:" : "📝"}
                  </span>
                  <span className="whitespace-pre-wrap text-ink-500">
                    {log.content}
                  </span>
                </div>
              ))}
            </div>
          )}

          {task.status === "running" && !hasLogs && (
            <div className="flex items-center gap-2">
              <span className="h-1 w-1 animate-pulse rounded-full bg-brand-400" />
              <span className="text-xs text-ink-400">正在处理中…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function AiThinkingStream({
  tasks,
  isStreaming,
  persistedTotalMs,
}: {
  tasks: TaskRecord[];
  isStreaming: boolean;
  /** Total thinking duration in ms — pre-populates the collapsed state.
   *  Only used when the component first mounts on a historical message. */
  persistedTotalMs?: number;
}) {
  // Single shared tick for all StepRow instances — avoids O(N) interval cost.
  const [now, setNow] = useState(Date.now());

  // On mount: if persistedTotalMs is set (historical message from DB),
  // start collapsed since the thinking is already done.
  const [collapsed, setCollapsed] = useState(
    persistedTotalMs !== undefined && !isStreaming
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Drive the shared `now` tick — only runs when there are live tasks.
  useEffect(() => {
    const hasLive = tasks.some((t) => t.status === "running" || t.status === "pending");
    if (!hasLive) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [tasks]);

  // Auto-collapse 1.5s after completion (only for live streaming, not historical)
  useEffect(() => {
    const isRunning = tasks.some((t) => t.status === "running" || t.status === "pending");
    if (!isRunning && tasks.length > 0 && !collapsed && persistedTotalMs === undefined) {
      const timer = setTimeout(() => setCollapsed(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [tasks.map(t => t.status).join(","), collapsed, isStreaming, persistedTotalMs]);

  if (tasks.length === 0) return null;

  const isRunning = tasks.some((t) => t.status === "running" || t.status === "pending");

  const totalMs =
    persistedTotalMs !== undefined && Number.isFinite(persistedTotalMs) && persistedTotalMs > 0
      ? persistedTotalMs
      : (() => {
          if (tasks.length === 0) return 0;
          const validStarts = tasks
            .map((t) => t.startTime)
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
          const validEnds = tasks
            .map((t) => (t.status === "running" ? now : t.endTime))
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
          if (validStarts.length === 0) return 0;
          if (validEnds.length === 0) return Math.max(0, now - Math.min(...validStarts));
          return Math.max(0, Math.max(...validEnds) - Math.min(...validStarts));
        })();

  const doneCount = tasks.filter((t) => t.status === "success").length;
  const errorCount = tasks.filter((t) => t.status === "error").length;

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Collapsed summary bar — click to expand
  if (collapsed && !isRunning && !isStreaming) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="mb-2 flex items-center gap-2 rounded-lg border border-brand-200 bg-gradient-to-r from-brand-50 to-white px-3 py-2 text-xs text-ink-600 shadow-sm transition-all hover:border-brand-300 hover:shadow"
      >
        {isRunning ? (
          <>
            <ThinkingOrb state="working" size={20} />
            <span className="font-medium text-brand-700">正在思考</span>
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">
              思考完成 · {doneCount} 步
              {errorCount > 0 && <span className="text-red-500"> · {errorCount} 失败</span>}
              {" · "}{formatDuration(totalMs)}
            </span>
          </>
        )}
        <svg className="ml-auto h-3 w-3 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    );
  }

  // Expanded view — vertical steps list with dividers
  // Container chrome (border, bg, padding) is provided by AiResponsePanel
  return (
    <div>
      {/* Collapsed toggle for done streaming */}
      {!isRunning && !isStreaming && (
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs font-medium text-ink-500">
              共 {tasks.length} 个步骤
              {errorCount > 0 && <span className="text-red-500"> · {errorCount} 个失败</span>}
              {" · "}
            </span>
            <span className="font-mono text-xs text-brand-600">
              总耗时 {formatDuration(totalMs)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded-md px-2 py-1 text-xs text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
          >
            收起
          </button>
        </div>
      )}

      {/* Running indicator */}
      {isRunning && (
        <div className="mb-1 flex items-center gap-2">
          <ThinkingOrb state="working" size={20} />
          <span className="text-xs font-medium text-brand-700">正在思考</span>
          <span className="font-mono text-xs text-brand-500">{formatDuration(totalMs)}</span>
        </div>
      )}

      {/* Steps list with dividers */}
      {tasks.map((task, idx) => (
        <div
          key={task.id}
          className={idx < tasks.length - 1 ? "border-b border-ink-100" : undefined}
        >
          <StepRow
            task={task}
            isExpanded={expandedIds.has(task.id)}
            onToggle={() => toggleExpand(task.id)}
            now={now}
            nextTask={idx < tasks.length - 1 ? tasks[idx + 1] : undefined}
          />
        </div>
      ))}
    </div>
  );
}
