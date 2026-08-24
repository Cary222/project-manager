"use client";

import { IconSparkles } from "@/shared/ui/icons";

interface AiTypingBubbleProps {
  // Override the small "正在思考…" caption below the dots. When omitted,
  // the default phrasing is used so existing call sites are unaffected.
  text?: string;
}

export function AiTypingBubble({ text }: AiTypingBubbleProps) {
  const caption = text ?? "小星正在思考…";
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-sm">
        <IconSparkles width={16} height={16} />
      </div>
      <div className="flex flex-col items-start">
        <div className="rounded-2xl rounded-bl-md bg-ink-100 px-4 py-3">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-ink-400 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-ink-400 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-ink-400" />
          </div>
        </div>
        <span className="mt-1 text-[10px] text-ink-400">{caption}</span>
      </div>
    </div>
  );
}