"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { IconSparkles } from "@/shared/ui/icons";

export interface SourceReference {
  index: number;
  title: string;
  url: string;
  type: "ticket" | "commit" | "note";
}

interface AiMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  isStreaming?: boolean;
}

// Typewriter timing (in milliseconds per character):
//  - MIN: floor — we always type at least this fast so the user never waits
//         when SSE is silent because the LLM is "thinking".
//  - MAX: ceiling — we never type faster than this so big SSE bursts don't
//         dump dozens of characters on screen at once.
//  Target reading speed sits between the two (~45 ms/char ≈ 22 cps).
const TYPEWRITER_MIN_MS_PER_CHAR = 18;
const TYPEWRITER_MAX_MS_PER_CHAR = 55;

// Deduplicate sources by URL. The RAG retrieval returns each chunk of a note
// independently (so the LLM can pick the right slice), but to the user a
// three-chunk note should look like one source, not three.
// The first occurrence wins, since the backend serves them in score order.
function dedupeSourcesByUrl(sources: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

export function AiMessageBubble({ role, content, sources, isStreaming }: AiMessageBubbleProps) {
  const isUser = role === "user";
  const dedupedSources = sources ? dedupeSourcesByUrl(sources) : undefined;
  // User messages always render the full content. Assistant messages start
  // empty and are revealed by the typewriter loop below.
  const [displayed, setDisplayed] = useState(isUser ? content : "");
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
    if (isUser) return;

    if (!isStreaming) {
      // Snap to whatever content we have so the bubble never shows stale text.
      // Defer to a microtask so we don't setState synchronously inside an effect.
      if (displayed !== content) {
        const handle = setTimeout(() => setDisplayed(content), 0);
        return () => clearTimeout(handle);
      }
      return;
    }

    // Start the typewriter loop only once per streaming session. The loop
    // self-schedules via rAF and reads contentRef/displayedRef to know what
    // to render next, so new SSE chunks don't restart the animation.
    if (rafRef.current !== null) return;

    let lastFrameAt = performance.now();

    const tick = () => {
      const target = contentRef.current;
      const current = displayedRef.current;

      if (current.length >= target.length) {
        // Caught up. Park until new content arrives.
        rafRef.current = null;
        return;
      }

      // How many characters are we currently behind the SSE front?
      const backlog = target.length - current.length;

      // Adaptive speed:
      //  - If we have a recent SSE burst sample, type just fast enough to
      //    drain the backlog in roughly one frame (≈16ms at 60fps). That
      //    keeps the cursor glued to the SSE front without sudden jumps.
      //  - Otherwise (SSE was quiet for a while), fall back to the constant
      //    MIN rate so the user still sees progress while the LLM thinks.
      const now = performance.now();
      const frameDelta = now - lastFrameAt;
      lastFrameAt = now;

      // Estimate current SSE rate from the most recent chunk.
      // chunkMs = how long it took the server to produce those chars.
      const chunkLen = lastChunkLengthRef.current;
      const chunkAt = lastChunkAtRef.current;
      let msPerChar = TYPEWRITER_MAX_MS_PER_CHAR;
      if (chunkLen > 0 && chunkAt > 0 && now - chunkAt < 1000) {
        // Assume the server delivered those chars in a typical ~80ms burst.
        const assumedBurstMs = 80;
        msPerChar = Math.max(
          TYPEWRITER_MIN_MS_PER_CHAR,
          Math.min(TYPEWRITER_MAX_MS_PER_CHAR, assumedBurstMs / chunkLen)
        );
      }

      // Reveal enough characters to keep up, but never more than the backlog.
      // frameDelta / msPerChar ≈ how many chars fit in this frame.
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
  }, [isStreaming, isUser, content, displayed]);

  // Pin the bubble height to the final content once it arrives so the
  // surrounding list doesn't reflow each tick (no jitter).
  const finalLength = isStreaming ? displayed.length : content.length;
  const targetLength = content.length;
  const showCursor = !isUser && isStreaming && finalLength < targetLength;

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          isUser ? "bg-brand-600 text-white" : "bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-sm"
        }`}
      >
        {isUser ? "U" : <IconSparkles width={16} height={16} />}
      </div>

      <div className={`max-w-[75%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? "bg-brand-600 text-white rounded-br-md"
              : "bg-ink-100 text-ink-900 rounded-bl-md"
          }`}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
          ) : (
            // Reserve the full height for the final content while streaming so
            // characters that wrap to a new line never push the layout down.
            <div className="relative">
              <div
                aria-hidden="true"
                className="invisible prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-headings:my-2 prose-headings:font-semibold prose-strong:font-semibold"
              >
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
              <div className="absolute inset-0 prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-headings:my-2 prose-headings:font-semibold prose-strong:font-semibold">
                <ReactMarkdown>{displayed}</ReactMarkdown>
                {showCursor && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-brand-600 align-middle" />
                )}
              </div>
            </div>
          )}
        </div>

        {!isUser && dedupedSources && dedupedSources.length > 0 && (
          <div className="mt-2 rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-xs font-medium text-ink-500">参考来源</p>
            <div className="space-y-1.5">
              {dedupedSources.map((source) => (
                <Link
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-brand-600 transition hover:text-brand-700"
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-ink-100 text-[10px] font-medium text-ink-500">
                    {source.index}
                  </span>
                  <span className="truncate">{source.title}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <span className="mt-1 text-[10px] text-ink-400">
          {isUser ? "你" : "小星"}
        </span>
      </div>
    </div>
  );
}