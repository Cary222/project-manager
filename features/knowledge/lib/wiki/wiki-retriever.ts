import type { QueryUnderstanding } from "@/features/ai/search/query-understanding";
import type { Evidence } from "@/features/ai/search/retrieval-router";
import type { WikiPage } from "./types";
import { findWikiPageByQuery, listAllWikiPages, getOrSynthesizeWikiPage } from "./wiki-store";
import type { WikiDatabaseClient } from "./wiki-synthesizer";
import type { prisma } from "@/shared/db/client";

/**
 * Converts a synthesized WikiPage into a standard Retrieval Evidence item.
 * Preserves bidirectional links to raw Source Evidence in metadata and paths.
 */
export function wikiPageToEvidence(page: WikiPage): Evidence {
  const sourceCitations = page.sourceEvidence.map(
    (se) => `${page.title} -[SYNTHESIZED_FROM]-> [${se.type}] ${se.title}`,
  );

  return {
    id: page.id,
    type: "note",
    title: page.title,
    content: `${page.summary}\n\n${page.content}`,
    url: `/projects/${page.projectId ?? "knowledge"}?tab=wiki&slug=${page.slug}`,
    channel: "wiki",
    paths: sourceCitations.slice(0, 5),
    metadata: {
      isWiki: true,
      slug: page.slug,
      category: page.category,
      projectId: page.projectId,
      sourceEvidence: page.sourceEvidence,
      version: page.version,
      generatedAt: page.generatedAt,
    },
  };
}

/**
 * Wiki Retriever (The 4th Knowledge Retrieval Lane).
 * Directly resolves high-level project overviews and architecture summaries
 * while retaining full traceability to underlying tickets, commits, and documents.
 */
export async function searchWikiCandidates(
  plan: QueryUnderstanding,
  query: string,
  _signal?: AbortSignal,
  options?: { db?: WikiDatabaseClient | typeof prisma },
): Promise<Evidence[]> {
  const targetQuery = (plan.subject || query).trim().toLowerCase();
  const matchedPage = await getOrSynthesizeWikiPage(targetQuery, options);

  if (matchedPage) {
    return [wikiPageToEvidence(matchedPage)];
  }

  // Fallback: match by project name or alias
  const allPages = listAllWikiPages();
  const candidates = allPages.filter((p) => {
    if (p.projectName && targetQuery.includes(p.projectName.toLowerCase()))
      return true;
    if (p.slug.includes(targetQuery)) return true;
    if (p.title.toLowerCase().includes(targetQuery)) return true;
    return false;
  });

  return candidates.map(wikiPageToEvidence);
}
