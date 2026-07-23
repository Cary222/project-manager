"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader,
  IconMinus,
  IconX,
} from "@/shared/ui/icons";
import type { ThinkingStep } from "@/features/ai/lib/types";

interface AiThinkingTraceProps {
  /**
   * 当前流程的节点进度列表。顺序即渲染顺序；status 为 `pending` 或 `running`
   * 的节点会被高亮；其它节点分别走 done / skipped / error 的样式。
   */
  steps: ThinkingStep[];
  /**
   * 折叠状态由父组件控制：默认运行中展开、结束后父组件置为 true 收起。
   * 设为 undefined 时由组件按 `steps` 自动判断（仍有 running/pending → 展开）。
   */
  collapsed?: boolean;
  onToggle?: () => void;
}

/**
 * AI 思考流程面板：把 LangGraph 每个节点的进度、耗时、原始输出展示给用户，
 * 让"AI 在做什么"对用户可见。
 */
export function AiThinkingTrace({ steps, collapsed, onToggle }: AiThinkingTraceProps) {
  // 自动折叠：所有节点状态 ∈ {done, skipped, error} 且非空 → 1.5s 后折叠。
  const hasInFlight = steps.some(
    (s) => s.status === "running" || s.status === "pending",
  );
  const autoCollapsed = !hasInFlight && steps.length > 0;
  const [userCollapsed, setUserCollapsed] = useState(false);

  const collapsedFinal = collapsed ?? (hasInFlight ? false : userCollapsed || autoCollapsed);

  const summary = useMemo(() => {
    const total = computeTotalElapsed(steps);
    const done = steps.filter((s) => s.status === "done").length;
    const err = steps.filter((s) => s.status === "error").length;
    const skip = steps.filter((s) => s.status === "skipped").length;
    return { total, done, err, skip };
  }, [steps]);

  if (steps.length === 0) return null;

  const handleToggle = () => {
    setUserCollapsed((v) => !v);
    onToggle?.();
  };

  return (
    <div className="mx-4 mb-2 rounded-xl border border-ink-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={!collapsedFinal}
      >
        <span className="flex items-center gap-2 text-ink-600">
          {collapsedFinal ? (
            <IconChevronRight className="h-3 w-3" />
          ) : (
            <IconChevronDown className="h-3 w-3" />
          )}
          <span className="font-medium">思考流程</span>
          {!collapsedFinal && hasInFlight && (
            <IconLoader className="h-3 w-3 animate-spin text-brand-500" />
          )}
        </span>
        <span className="flex items-center gap-2 text-ink-400">
          <span>共耗时 {formatElapsed(summary.total)}</span>
          <span>·</span>
          <span>
            {summary.done} 完成
            {summary.err > 0 && ` / ${summary.err} 失败`}
            {summary.skip > 0 && ` / ${summary.skip} 跳过`}
          </span>
        </span>
      </button>

      {!collapsedFinal && (
        <div className="border-t border-ink-100 px-3 py-2">
          <ol className="flex flex-col gap-1">
            {steps.map((step, idx) => (
              <StepRow
                key={step.nodeName}
                step={step}
                isLast={idx === steps.length - 1}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function StepRow({ step, isLast }: { step: ThinkingStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isClickable =
    (step.status === "done" || step.status === "error") &&
    (step.output !== undefined || step.error !== undefined);

  return (
    <li className="relative pl-6">
      {/* 节点之间的竖直连线 */}
      {!isLast && (
        <span
          className="absolute left-[10px] top-5 h-[calc(100%-12px)] w-px bg-ink-200"
          aria-hidden
        />
      )}
      {/* 状态图标 */}
      <span className="absolute left-1 top-1.5 flex h-4 w-4 items-center justify-center">
        <StatusIcon status={step.status} />
      </span>

      <div
        className={`flex flex-col rounded-lg px-2 py-1.5 ${
          step.status === "running"
            ? "bg-brand-50"
            : step.status === "done"
              ? "bg-success-50"
              : step.status === "error"
                ? "bg-danger-50"
                : "bg-ink-50"
        }`}
        data-testid={`thinking-step-${step.nodeName}`}
      >
        <button
          type="button"
          disabled={!isClickable}
          onClick={() => setExpanded((v) => !v)}
          aria-label={`${step.nodeLabel}${
            step.toolName ? ` (${step.toolName})` : ""
          } ${statusLabel(step.status)}`}
          className={`flex w-full items-center justify-between gap-2 text-left text-xs ${
            isClickable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={`font-medium ${
                step.status === "skipped"
                  ? "text-ink-400 line-through"
                  : "text-ink-700"
              }`}
            >
              {step.nodeLabel}
            </span>
            {step.toolName && (
              <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
                {step.toolName}
              </span>
            )}
            <span
              className={`text-[10px] ${
                step.status === "done"
                  ? "text-success-600"
                  : step.status === "running"
                    ? "text-brand-600"
                    : step.status === "error"
                      ? "text-danger-600"
                      : "text-ink-400"
              }`}
            >
              {statusLabel(step.status)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-ink-400">
            <ElapsedLabel step={step} />
            {isClickable &&
              (expanded ? (
                <IconChevronDown className="h-3 w-3" />
              ) : (
                <IconChevronRight className="h-3 w-3" />
              ))}
          </span>
        </button>

        {expanded && isClickable && (
          <RawOutputPanel step={step} />
        )}
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: ThinkingStep["status"] }) {
  switch (status) {
    case "running":
      return <IconLoader className="h-3 w-3 animate-spin text-brand-500" />;
    case "done":
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-success-500 text-white">
          <IconCheck className="h-2 w-2" />
        </span>
      );
    case "error":
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-danger-500 text-white">
          <IconX className="h-2 w-2" />
        </span>
      );
    case "skipped":
      return (
        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-ink-200 text-ink-400">
          <IconMinus className="h-2 w-2" />
        </span>
      );
    case "pending":
    default:
      return <span className="h-3 w-3 rounded-full border border-ink-300 bg-white" />;
  }
}

function statusLabel(status: ThinkingStep["status"]): string {
  switch (status) {
    case "pending":
      return "等待中";
    case "running":
      return "进行中";
    case "done":
      return "已完成";
    case "skipped":
      return "已跳过";
    case "error":
      return "失败";
    default:
      return "";
  }
}

/**
 * 节点耗时：
 * - running：每秒刷新一次"已用时长"
 * - done / error：定格最终耗时
 * - pending / skipped：显示 `—`
 */
function ElapsedLabel({ step }: { step: ThinkingStep }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (step.status !== "running" || step.startedAt === undefined) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [step.status, step.startedAt]);

  if (step.status === "running" && step.startedAt !== undefined) {
    // 依赖 tick 触发重渲染
    void tick;
    // startedAt 使用 performance time origin，必须使用同一时钟计算。
    // eslint-disable-next-line react-hooks/purity
    const ms = performance.now() - step.startedAt;
    return <span className="font-mono">{formatElapsed(ms)}</span>;
  }
  if (
    (step.status === "done" || step.status === "error") &&
    step.startedAt !== undefined &&
    step.endedAt !== undefined
  ) {
    return (
      <span className="font-mono">{formatElapsed(step.endedAt - step.startedAt)}</span>
    );
  }
  return <span className="font-mono">—</span>;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function computeTotalElapsed(steps: ThinkingStep[]): number {
  // 总耗时：从第一个 startedAt 到最末 endedAt；如果还有 running，从其 startedAt 到 now。
  const started = steps
    .map((s) => s.startedAt)
    .filter((v): v is number => typeof v === "number");
  if (started.length === 0) return 0;
  const start = Math.min(...started);
  const ended = steps
    .map((s) => s.endedAt)
    .filter((v): v is number => typeof v === "number");
  const hasRunning = steps.some((s) => s.status === "running");
  // startedAt / endedAt 使用 performance time origin。
  const end = hasRunning ? performance.now() : ended.length > 0 ? Math.max(...ended) : start;
  return Math.max(0, end - start);
}

function RawOutputPanel({ step }: { step: ThinkingStep }) {
  if (step.status === "error") {
    return (
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-2 font-mono text-[11px] text-danger-700">
        {step.error ?? "未知错误"}
      </pre>
    );
  }
  const output = step.output;
  if (output === undefined || output === null) {
    return (
      <p className="mt-2 text-[11px] text-ink-400">（无输出）</p>
    );
  }
  if (typeof output === "string") {
    return (
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-2 font-mono text-[11px] text-ink-700">
        {output}
      </pre>
    );
  }
  let serializedOutput: string;
  try {
    serializedOutput = JSON.stringify(output, null, 2);
  } catch {
    serializedOutput = String(output);
  }
  return (
    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-2 font-mono text-[11px] text-ink-700">
      {serializedOutput}
    </pre>
  );
}