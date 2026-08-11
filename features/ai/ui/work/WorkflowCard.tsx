"use client";

import { useCallback } from "react";

interface WorkflowCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onLaunch: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function WorkflowCard({
  title,
  description,
  icon,
  onLaunch,
  disabled = false,
  isLoading = false,
}: WorkflowCardProps) {
  return (
    <button
      onClick={() => {
        if (!disabled && !isLoading) {
          onLaunch();
        }
      }}
      disabled={disabled || isLoading}
      className="group w-full rounded-xl border border-ink-200 bg-white p-4 text-left transition-all hover:border-brand-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink-900">{title}</h3>
          <p className="mt-0.5 text-sm text-ink-500 line-clamp-2">{description}</p>
        </div>
        {isLoading ? (
          <div className="flex h-8 w-16 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          </div>
        ) : (
          <div className="flex h-8 flex-shrink-0 items-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-ink-400 transition-transform group-hover:translate-x-0.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        )}
      </div>
    </button>
  );
}
