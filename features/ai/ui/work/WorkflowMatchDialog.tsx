"use client";

import { useCallback } from "react";

export interface WorkflowMatchDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Workflow type */
  workflowType: string;
  /** Workflow name */
  workflowName: string;
  /** Workflow description */
  description: string;
  /** Loading state when starting workflow */
  isStarting: boolean;
  /** Called when user confirms to start the workflow */
  onConfirm: () => void;
  /** Called when user cancels */
  onCancel: () => void;
}

/**
 * Workflow match dialog — shown when AI detects user wants to run a workflow.
 * Displays the matched workflow info and lets user confirm or cancel.
 */
export function WorkflowMatchDialog({
  isOpen,
  workflowType,
  workflowName,
  description,
  isStarting,
  onConfirm,
  onCancel,
}: WorkflowMatchDialogProps) {
  if (!isOpen) return null;

  const handleConfirm = useCallback(() => {
    onConfirm();
  }, [onConfirm]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm pm-fade-in"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-xl">
        {/* Icon */}
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-sm">
          <svg
            width="28"
            height="28"
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

        {/* Title */}
        <h2 className="text-xl font-semibold text-ink-900">
          检测到工作流意图
        </h2>

        {/* Workflow Info */}
        <div className="mt-4 rounded-lg border border-ink-100 bg-ink-50/50 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-ink-900">{workflowName}</p>
              <p className="text-xs text-ink-500">
                类型：{workflowType}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-600">{description}</p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleCancel}
            disabled={isStarting}
            className="flex-1 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={isStarting}
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {isStarting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                启动中...
              </span>
            ) : (
              "启动工作流"
            )}
          </button>
        </div>

        {/* Hint */}
        <p className="mt-3 text-center text-xs text-ink-400">
          启动后将切换到工作模式执行任务
        </p>
      </div>
    </div>
  );
}
