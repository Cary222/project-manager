"use client";

import { useEffect, useRef, useState } from "react";
import { AiResponsePanel } from "./AiResponsePanel";
import type { TaskRecord } from "@/features/ai/types";
import type { SourceReference } from "./AiSourcesList";

interface CandidateUser {
  id: string;
  label?: string;
  summary?: string;
  name?: string;
  email?: string;
  sublabel?: string;
}

interface AiMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  candidates?: CandidateUser[];
  isStreaming?: boolean;
  thinkingSteps?: TaskRecord[];
  totalThinkingMs?: number;
  onCandidateSelect?: (candidateId: string) => void;
}

// Typewriter timing (in milliseconds per character):
//  - MIN: floor — we always type at least this fast so the user never waits
//         when SSE is silent because the LLM is "thinking".
//  - MAX: ceiling — we never type faster than this so big SSE bursts don't
//         dump dozens of characters on screen at once.
//  Target reading speed sits between the two (~45 ms/char ≈ 22 cps).
const TYPEWRITER_MIN_MS_PER_CHAR = 18;
const TYPEWRITER_MAX_MS_PER_CHAR = 55;

export function AiMessageBubble({
  role,
  content,
  sources,
  candidates,
  isStreaming,
  thinkingSteps,
  totalThinkingMs,
  onCandidateSelect,
}: AiMessageBubbleProps) {
  const isUserMessage = role === "user";
  const hasCandidates = candidates && candidates.length > 0;

  // User messages always render the full content. Assistant messages start
  // empty and are revealed by the typewriter loop below.
  const [displayed, setDisplayed] = useState(isUserMessage ? content : "");

  // Keep latest content/streaming flags in refs so the typewriter loop reads
  // fresh values without restarting on every SSE chunk. This eliminates
  // flicker caused by useEffect re-running per chunk.
  const contentRef = useRef(content);
  const streamingRef = useRef(isStreaming);
  const displayedRef = useRef(displayed);
  const rafRef = useRef<number | null>(null);

  // Track arrival rate of SSE chars so we can adapt the reveal speed.
  const lastChunkLengthRef = useRef(0);
  const lastChunkAtRef = useRef(0);

  // Sync refs AFTER commit (not during render) to satisfy React 19 ref rules.
  useEffect(() => {
    contentRef.current = content;
    if (streamingRef.current && isStreaming && content.length > contentRef.current.length) {
      lastChunkLengthRef.current = content.length - contentRef.current.length;
      lastChunkAtRef.current = performance.now();
    }
    streamingRef.current = isStreaming;
    displayedRef.current = displayed;
  });

  useEffect(() => {
    // User messages render the full content directly via the `content` prop
    // and never need the typewriter loop, so this effect is a no-op for them.
    if (isUserMessage) return;

    if (!isStreaming) {
      // Snap to whatever content we have so the bubble never shows stale text.
      // Defer to a microtask so we don't setState synchronously inside an effect.
      if (displayed !== content) {
        const handle = setTimeout(() => setDisplayed(content), 0);
        return () => clearTimeout(handle);
      }
      return;
    }

    // Start the typewriter loop only once per streaming session.
    if (rafRef.current !== null) return;

    let lastFrameAt = performance.now();

    const tick = () => {
      const target = contentRef.current;
      const current = displayedRef.current;

      if (current.length >= target.length) {
        rafRef.current = null;
        return;
      }

      const backlog = target.length - current.length;
      const now = performance.now();
      const frameDelta = now - lastFrameAt;
      lastFrameAt = now;

      // Adaptive speed based on SSE arrival rate
      const chunkLen = lastChunkLengthRef.current;
      const chunkAt = lastChunkAtRef.current;
      let msPerChar = TYPEWRITER_MAX_MS_PER_CHAR;
      if (chunkLen > 0 && chunkAt > 0 && now - chunkAt < 1000) {
        const assumedBurstMs = 80;
        msPerChar = Math.max(
          TYPEWRITER_MIN_MS_PER_CHAR,
          Math.min(TYPEWRITER_MAX_MS_PER_CHAR, assumedBurstMs / chunkLen)
        );
      }

      const step = Math.max(1, Math.min(backlog, Math.round(frameDelta / msPerChar)));
      const nextLength = current.length + step;
      const nextText = target.slice(0, nextLength);
      setDisplayed(nextText);
      displayedRef.current = nextText;

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isStreaming, isUserMessage, content, displayed]);

  // User message: right-aligned bubble (max-w-[75%])
  if (isUserMessage) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="rounded-2xl bg-brand-600 px-4 py-2.5 text-white rounded-br-md">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
          </div>
          <span className="mt-1 block text-[10px] text-ink-400">你</span>
        </div>
      </div>
    );
  }

  // AI message: Code Agent style — left-aligned full-width panel
  return (
    <div className="w-full">
      {/* Candidate selection buttons (Human-in-Loop) */}
      {!isStreaming && hasCandidates && onCandidateSelect && (
        <div className="mb-2 flex flex-col gap-1.5">
          {candidates!.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onCandidateSelect(candidate.id)}
              className="w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm transition-colors hover:border-warning/60 hover:bg-warning/20"
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-warning/20 text-xs font-medium text-warning-foreground">
                {index + 1}
              </span>
              <span className="font-medium text-ink-900">{candidate.label ?? candidate.name}</span>
              {(candidate.email ?? candidate.sublabel) && (
                <span className="ml-2 text-xs text-ink-500">{candidate.email ?? candidate.sublabel}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <AiResponsePanel
        content={displayed}
        thinkingSteps={thinkingSteps}
        sources={sources}
        isStreaming={isStreaming}
        totalThinkingMs={totalThinkingMs}
      />
    </div>
  );
}
