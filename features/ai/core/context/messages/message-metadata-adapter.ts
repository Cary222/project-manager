/**
 * Message Metadata Adapter — rehydrates raw DB metadata into structured response metadata.
 *
 * Converts stored tool results and other metadata into a clean shape for
 * AIMessage.response_metadata. This is the inverse of what appendMessage stores.
 *
 * Tool results are summarized (not verbatim) to keep metadata lean:
 *   - searchStructured: count + up to 10 entity names
 *   - searchKnowledge: count only
 */

export interface RehydratedMetadata {
  sources?: Array<{ index: number; title: string; url: string; type: string }>;
  thinkingSteps?: string[];
  toolSummary?: {
    searchStructured?: { count: number; entities: string[] };
    searchKnowledge?: { count: number };
  };
}

/**
 * Adapt raw metadata from DB into RehydratedMetadata.
 * Returns null if no useful metadata is present.
 */
export function adaptMessageMetadata(raw: unknown): RehydratedMetadata | null {
  if (!raw || typeof raw !== "object") return null;

  const m = raw as Record<string, unknown>;
  const result: RehydratedMetadata = {};

  // Sources
  if (Array.isArray(m.sources)) {
    result.sources = m.sources as RehydratedMetadata["sources"];
  }

  // Thinking steps
  if (Array.isArray(m.thinkingSteps)) {
    result.thinkingSteps = m.thinkingSteps as string[];
  }

  // Tool summaries
  if (m.toolResults && typeof m.toolResults === "object") {
    const tr = m.toolResults as Record<string, unknown>;
    result.toolSummary = {};

    if (tr.searchStructured && typeof tr.searchStructured === "object") {
      const ss = tr.searchStructured as Record<string, unknown>;
      result.toolSummary.searchStructured = {
        count: Array.isArray(ss.rows) ? (ss.rows as unknown[]).length : 0,
        entities: extractEntityNames(ss.rows).slice(0, 10),
      };
    }

    if (tr.searchKnowledge && typeof tr.searchKnowledge === "object") {
      const sk = tr.searchKnowledge as Record<string, unknown>;
      result.toolSummary.searchKnowledge = {
        count: typeof sk.count === "number" ? sk.count : 0,
      };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract entity names from tool result rows (searchStructured).
 * Looks for `name` or `title` fields — the most common identity fields.
 */
function extractEntityNames(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];

  const names = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      if (typeof r.name === "string") names.add(r.name);
      if (typeof r.title === "string") names.add(r.title);
    }
  }
  return Array.from(names);
}
