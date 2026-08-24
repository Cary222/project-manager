"use client";

import { useState } from "react";
import type { CandidateUser } from "./AiChatPanel";

export interface CandidateOption {
  id: string;
  label: string;
  sublabel?: string;
}

interface AiCandidatePickerProps {
  isPage: boolean;
  /** 候选项（支持 label/summary 或 name/email 格式） */
  options: CandidateUser[];
  /** 选中候选项时回调，参数为候选项本身 */
  onSelect: (option: CandidateUser) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 用户在输入框里手动输入并提交时回调 */
  onCustomInput?: (text: string) => void;
  /** 自定义输入框的占位文本 */
  customInputPlaceholder?: string;
}

export function AiCandidatePicker({
  isPage,
  options,
  onSelect,
  onCancel,
  onCustomInput,
  customInputPlaceholder = "输入其他内容…",
}: AiCandidatePickerProps) {
  const [customText, setCustomText] = useState("");

  const submitCustom = () => {
    const trimmed = customText.trim();
    if (!trimmed || !onCustomInput) return;
    onCustomInput(trimmed);
    setCustomText("");
  };

  return (
    <div
      className={`border-t border-ink-200 ${
        isPage ? "px-6 pt-4" : "px-3 pt-3"
      } pb-1`}
    >
      <div className="flex flex-wrap gap-2">
        {options.map((option, index) => {
          const id = option.id;
          // Support both formats: HIL (label/summary) and legacy assignee (name/email).
          const label = option.label ?? option.name ?? "";
          const sublabel = option.email ?? option.sublabel ?? "";

          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(option)}
              className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-700 shadow-sm transition hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 active:bg-ink-100"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-100 text-xs font-medium text-ink-500">
                {index + 1}
              </span>
              <span className="font-medium">{label}</span>
              {sublabel && (
                <span className="text-xs text-ink-400">{sublabel}</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs text-ink-500 transition hover:border-ink-300 hover:bg-ink-50 hover:text-ink-700"
        >
          取消
        </button>
      </div>

      {onCustomInput && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitCustom();
              }
            }}
            placeholder={customInputPlaceholder}
            aria-label="自定义输入"
            className="flex-1 rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
          <button
            type="button"
            onClick={submitCustom}
            disabled={!customText.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 active:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none"
          >
            提交
          </button>
        </div>
      )}
    </div>
  );
}