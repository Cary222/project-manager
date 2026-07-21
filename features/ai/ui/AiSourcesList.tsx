"use client";

import Link from "next/link";
import { IconExternalLink, IconTicket, IconProject, IconTeam, IconReport, IconRepo } from "@/shared/ui/icons";

/** Shared source reference shape */
export interface SourceReference {
  index?: number;
  title: string;
  url: string;
  type: "ticket" | "commit" | "note" | "project" | "user" | "weekly_report";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deduplicate sources by URL. The RAG retrieval returns each chunk of a note
 * independently (so the LLM can pick the right slice), but to the user a
 * three-chunk note should look like one source, not three.
 * The first occurrence wins, since the backend serves them in score order.
 */
export function dedupeSourcesByUrl(sources: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "ticket":
      return <IconTicket width={12} height={12} />;
    case "project":
      return <IconProject width={12} height={12} />;
    case "user":
      return <IconTeam width={12} height={12} />;
    case "commit":
      return <IconRepo width={12} height={12} />;
    case "weekly_report":
      return <IconReport width={12} height={12} />;
    default:
      return <IconExternalLink width={12} height={12} />;
  }
}

function SourceTypeLabel({ type }: { type: string }) {
  switch (type) {
    case "ticket": return "工单";
    case "project": return "项目";
    case "user": return "用户";
    case "commit": return "提交";
    case "weekly_report": return "周报";
    case "note": return "笔记";
    default: return "查看";
  }
}

/** 站内资源 → 可点击的 action button */
function isInlineAction(source: SourceReference): boolean {
  return (
    source.type === "ticket" ||
    source.type === "project" ||
    source.type === "user" ||
    source.type === "commit" ||
    source.type === "weekly_report"
  );
}

/** Parse ticket number from a source title like "#10144 agent应用开发" */
function parseTicketNo(title: string): string | null {
  const match = title.match(/#(\d+)/);
  return match ? match[1] : null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AiSourcesListProps {
  sources: SourceReference[];
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the reference sources section for an AI response bubble.
 *
 * Two layouts:
 * - Inline action buttons: 站内 types (ticket / project / user / commit / weekly_report)
 * - Passive reference card: non站内 types (note / external links)
 *
 * Accepts raw sources; deduplication and layout logic are internal.
 * Pass `sources` only after streaming is complete to avoid partial flashes.
 */
export function AiSourcesList({ sources }: AiSourcesListProps) {
  const deduped = dedupeSourcesByUrl(sources);
  const inlineActions = deduped.filter(isInlineAction);
  const passiveRefs = deduped.filter((s) => !isInlineAction(s));

  if (deduped.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Inline action buttons */}
      {inlineActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {inlineActions.map((source) => {
            const ticketNo = parseTicketNo(source.title);
            return (
              <Link
                key={source.url}
                href={source.url}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm transition hover:border-brand-400 hover:bg-brand-100 hover:text-brand-800"
              >
                <SourceTypeIcon type={source.type} />
                <span className="max-w-[140px] truncate">
                  {ticketNo ? `#${ticketNo}` : source.title}
                </span>
                <SourceTypeLabel type={source.type} />
                <IconExternalLink width={10} height={10} className="ml-0.5 shrink-0 opacity-60" />
              </Link>
            );
          })}
        </div>
      )}

      {/* Passive reference card */}
      {passiveRefs.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-xs font-medium text-ink-500">参考来源</p>
          <div className="space-y-1.5">
            {passiveRefs.map((source) => (
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
    </div>
  );
}
