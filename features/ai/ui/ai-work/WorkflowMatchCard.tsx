"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface WorkflowMatchCardProps {
  /** Whether the card is visible */
  isOpen: boolean;
  /** Workflow type */
  workflowType: string;
  /** Workflow name */
  workflowName: string;
  /** Workflow description */
  description: string;
  /** Auto-dismiss countdown in seconds */
  countdownSeconds?: number;
  /** Called when user confirms to start the workflow.
   *  Card optimistically dismisses itself immediately; parent handles
   *  mode switch + background POST. */
  onStartWorkflow: (workflowType: string) => void;
  /** Called when card auto-dismisses or user dismisses */
  onDismiss: () => void;
}

/**
 * Workflow match card — inline card in chat area for workflow launching.
 * Shows a countdown progress bar. User clicks "切换" to switch mode,
 * or the card auto-dismisses when the timer expires.
 */
export function WorkflowMatchCard({
  isOpen,
  workflowType,
  workflowName,
  description,
  countdownSeconds = 5,
  onStartWorkflow,
  onDismiss,
}: WorkflowMatchCardProps) {
  const [progress, setProgress] = useState(100); // 0-100
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Start countdown when card opens
  useEffect(() => {
    if (!isOpen) {
      setProgress(100);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    startTimeRef.current = Date.now();
    const totalMs = countdownSeconds * 1000;
    const tickMs = 50;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, 100 - (elapsed / totalMs) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        onDismiss();
      }
    }, tickMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isOpen, countdownSeconds, onDismiss]);

  const handleSwitch = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    // Optimistically dismiss immediately — don't wait for API.
    // Parent will switch mode + fire POST in background.
    onStartWorkflow(workflowType);
  }, [workflowType, onStartWorkflow]);

  const handleDismiss = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    onDismiss();
  }, [onDismiss]);

  if (!isOpen) return null;

  const isExpiring = progress < 30;

  return (
    <div className="pm-fade-in mx-auto max-w-md">
      <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4 shadow-md">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
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
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">检测到工作流意图</p>
              <p className="text-xs text-ink-500">{workflowName}</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
            aria-label="忽略"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <p className="mb-3 text-sm text-ink-600">{description}</p>

        {/* Progress bar */}
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className={`h-full rounded-full transition-all duration-75 ${
              isExpiring ? "bg-amber-400" : "bg-brand-500"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleDismiss}
            className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-50"
          >
            忽略
          </button>
          <button
            onClick={handleSwitch}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            切换到工作模式
          </button>
        </div>
      </div>
    </div>
  );
}
