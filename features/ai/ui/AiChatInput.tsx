"use client";

import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { IconMic, IconMicWave, IconPause, IconSend } from "@/shared/ui/icons";

interface AiChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function AiChatInput({
  onSend,
  onStop,
  isGenerating = false,
  disabled,
  placeholder = "输入消息...",
}: AiChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = message.trim();
      if (!trimmed || disabled) return;

      onSend(trimmed);
      setMessage("");

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    },
    [message, disabled, onSend]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    const textarea = e.target;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  const handleVoiceInput = useCallback(() => {
    // UI-only: voice input is not yet wired up to Web Speech API.
  }, []);

  const handleVoiceChat = useCallback(() => {
    // UI-only: voice chat is not yet wired up to Web Speech API.
  }, []);

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const hasContent = message.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none rounded-2xl border border-ink-200 bg-white px-4 py-3 pr-12 text-sm text-ink-900 placeholder-ink-400 transition focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
          style={{ minHeight: "44px", maxHeight: "120px" }}
        />
      </div>

      {isGenerating ? (
        <>
          <button
            type="button"
            disabled
            onClick={handleVoiceInput}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-300 transition disabled:cursor-not-allowed"
            title="语音输入（生成中不可用）"
            aria-label="语音输入（生成中不可用）"
          >
            <IconMic />
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger text-white shadow-sm transition hover:bg-red-600"
            title="停止对话"
            aria-label="停止对话"
          >
            <IconPause />
          </button>
        </>
      ) : hasContent ? (
        <>
          <button
            type="submit"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
            title="发送"
            aria-label="发送消息"
          >
            <IconSend />
          </button>
          <button
            type="button"
            onClick={handleVoiceChat}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
            title="语音对话"
            aria-label="语音对话"
          >
            <IconMicWave />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleVoiceInput}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
            title="语音输入"
            aria-label="语音输入"
          >
            <IconMic />
          </button>
          <button
            type="button"
            onClick={handleVoiceChat}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
            title="语音对话"
            aria-label="语音对话"
          >
            <IconMicWave />
          </button>
        </>
      )}
    </form>
  );
}