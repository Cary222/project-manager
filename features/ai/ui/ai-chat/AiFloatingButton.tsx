"use client";

import { useState } from "react";
import { AiChatPanel } from "./AiChatPanel";

export function AiFloatingButton() {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 hover:shadow-xl"
        aria-label="打开 AI 助手"
        title="打开 AI 助手"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 right-6 z-50 flex h-[640px] w-[380px] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-elevated">
      <div className="relative flex h-full min-h-0 flex-col">
        <button
          onClick={() => setIsOpen(false)}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100"
          aria-label="关闭"
          title="关闭"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <AiChatPanel variant="floating" />
      </div>
    </div>
  );
}