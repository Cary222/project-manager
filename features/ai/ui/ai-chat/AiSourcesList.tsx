"use client";

import Link from "next/link";
import { IconExternalLink, IconTicket, IconProject, IconTeam, IconReport, IconRepo, IconKnowledge } from "@/shared/ui/icons";

/** Shared source reference shape */
export interface SourceReference {
  index?: number;
  title: string;
  url: string;
  type: "ticket" | "commit" | "note" | "doc" | "project" | "user" | "weekly_report";
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
    case "note":
    case "doc":
      return <IconKnowledge width={12} height={12} />;
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
    case "doc": return "项目文档";
    default: return "查看";
  }
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
 * Unified card layout for all source types. Each item shows:
 * - Index badge (sequential, 1-based after dedup)
 * - Type icon (color-coded by type)
 * - Title (truncated)
 * - Type label chip
 *
 * Accepts raw sources; deduplication and layout logic are internal.
 * Pass `sources` only after streaming is complete to avoid partial flashes.
 */
export function AiSourcesList({ sources }: AiSourcesListProps) {
  const deduped = dedupeSourcesByUrl(sources);

  if (deduped.length === 0) return null;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-medium text-ink-500">参考来源</p>
      <div className="space-y-1.5">
        {deduped.map((source, displayIndex) => (
          <Link
            key={source.url}
            href={source.url}
            className="flex items-center gap-2 text-xs text-brand-600 transition hover:text-brand-700"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded bg-ink-100 text-[10px] font-medium text-ink-500">
              {source.index ?? displayIndex + 1}
            </span>
            <SourceTypeIcon type={source.type} />
            <span className="truncate">
              {source.type === "ticket"
                ? `#${parseTicketNo(source.title) ?? source.title}`
                : source.title}
            </span>
            <span className="ml-auto shrink-0 rounded-full border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
              <SourceTypeLabel type={source.type} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
