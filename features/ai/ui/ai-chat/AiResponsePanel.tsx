"use client";

/**
 * AiResponsePanel — Code Agent style AI response container.
 *
 * Layout:
 * ┌─────────────────────────────────────┐
 * │ <AiThinkingStream />                 │  ← Collapsible thinking trail
 * ├─────────────────────────────────────┤
 * │ <MarkdownContent />                 │  ← Complete Markdown answer
 * ├─────────────────────────────────────┤
 * │ <AiSourcesList />                   │  ← Reference sources
 * └─────────────────────────────────────┘
 *
 * Design: Card panel with border, rounded corners, and shadow.
 * - Outer container: rounded-xl border shadow-sm (Code Agent style)
 * - Thinking trail: gradient background with bottom border
 * - Markdown: padded inside the card
 * - Sources: separated by margin, not border
 */

import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { AiSourcesList, type SourceReference } from "./AiSourcesList";
import { MessageCopyButton } from "./MessageCopyButton";
import { AiThinkingStream } from "./AiThinkingStream";
import type { TaskRecord } from "@/features/ai/types";

interface AiResponsePanelProps {
  content: string;
  thinkingSteps?: TaskRecord[];
  sources?: SourceReference[];
  isStreaming?: boolean;
  totalThinkingMs?: number;
}

export function AiResponsePanel({
  content,
  thinkingSteps,
  sources,
  isStreaming,
  totalThinkingMs,
}: AiResponsePanelProps) {
  const hasThinking = thinkingSteps && thinkingSteps.length > 0;
  const hasSources = sources && sources.length > 0;
  const showCopyButton = !isStreaming;
  const showSources = !isStreaming && hasSources;

  return (
    <div className="w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      {/* ── Section 1: Thinking Trail (Collapsible) ────────────────────────── */}
      {hasThinking && (
        <div className="border-b border-ink-200 bg-gradient-to-b from-brand-50/30 to-white py-3 px-4">
          <AiThinkingStream
            tasks={thinkingSteps}
            isStreaming={!!isStreaming}
            persistedTotalMs={totalThinkingMs}
          />
        </div>
      )}

      {/* ── Section 2: Markdown Answer ──────────────────────────────────────── */}
      <div className="px-4 py-3">
        <MarkdownContent content={content} />
        {/* Cursor blink during streaming */}
        {isStreaming && (
          <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-brand-600 align-middle" />
        )}
      </div>

      {/* ── Section 3: Footer (Copy + Sources) ────────────────────────────── */}
      {(showCopyButton || showSources) && (
        <div className="mt-3 flex flex-col gap-2 px-4 pb-3">
          {showCopyButton && (
            <div className="flex justify-start">
              <MessageCopyButton content={content} />
            </div>
          )}
          {showSources && (
            <div>
              <AiSourcesList sources={sources!} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
