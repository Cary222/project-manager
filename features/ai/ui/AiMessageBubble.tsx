"use client";

import { useEffect, useRef, useState } from "react";
import { IconSparkles } from "@/shared/ui/icons";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { AiSourcesList, type SourceReference } from "./AiSourcesList";
import { MessageCopyButton } from "./MessageCopyButton";

interface CandidateUser {
  id: string;
  /** HIL format: label from disambiguateIntent (e.g. "cary（刘屹鹏）") */
  label?: string;
  summary?: string;
  /** Legacy assignee format: name from user record */
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
  /** Called when user clicks a candidate button — sends the selection back to AI */
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

export function AiMessageBubble({ role, content, sources, candidates, isStreaming, onCandidateSelect }: AiMessageBubbleProps) {
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
  // lastChunkLength = chars that arrived in the most recent SSE burst;
  // lastChunkAt     = timestamp of that burst.
  const lastChunkLengthRef = useRef(0);
  const lastChunkAtRef = useRef(0);

  // Sync refs AFTER commit (not during render) to satisfy React 19 ref rules.
  useEffect(() => {
    contentRef.current = content;
    // Remember how many characters arrived in this update and when, so the
    // typewriter can adapt to SSE cadence. Skip the very first sync (length
    // jump from 0 → content when streaming starts) so we don't poison the
    // average with one giant burst.
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

  // Pin the bubble height to the final content once it arrives so the
  // surrounding list doesn't reflow each tick (no jitter).
  const finalLength = isStreaming ? displayed.length : content.length;
  const targetLength = content.length;
  const showCursor = !isUserMessage && isStreaming && finalLength < targetLength;

  return (
    <div className={`flex gap-3 ${isUserMessage ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          isUserMessage
            ? "bg-brand-600 text-white"
            : "bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-sm"
        }`}
      >
        {isUserMessage ? "U" : <IconSparkles width={16} height={16} />}
      </div>

      {/* Bubble column */}
      <div className={`max-w-[75%] ${isUserMessage ? "items-end" : "items-start"} flex flex-col`}>
        {/* Chat bubble */}
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUserMessage
              ? "bg-brand-600 text-white rounded-br-md"
              : "bg-ink-100 text-ink-900 rounded-bl-md"
          }`}
        >
          {isUserMessage ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
          ) : (
            <div className="relative">
              {/* Ghost layer — reserves height for final content via @shared/ui/MarkdownContent */}
              <div aria-hidden="true" className="invisible">
                <MarkdownContent content={content} />
              </div>
              {/* Active layer — typewriter reveal, also reuses @shared/ui/MarkdownContent */}
              <div className="absolute inset-0 overflow-hidden">
                <MarkdownContent content={displayed} />
                {showCursor && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-brand-600 align-middle" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Candidate selection buttons (Human-in-Loop) */}
        {!isUserMessage && !isStreaming && hasCandidates && onCandidateSelect && (
          <div className="mt-2 flex flex-col gap-1.5">
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

        {!isStreaming && <MessageCopyButton content={content} />}

        {/* Reference sources — only render after streaming is done to avoid partial flash */}
        {!isUserMessage && !isStreaming && sources && sources.length > 0 && (
          <div className="mt-2">
            <AiSourcesList sources={sources} />
          </div>
        )}

        <span className="mt-1 text-[10px] text-ink-400">
          {isUserMessage ? "你" : "小星"}
        </span>
      </div>
    </div>
  );
}
