import { NextResponse } from "next/server";
import { searchDocuments } from "@/shared/lib/search";
import { requireSession } from "@/shared/lib/permissions";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const projectId = searchParams.get("projectId");
    const limitParam = Number(searchParams.get("limit") ?? "8");
    const modeParam = searchParams.get("mode");
    const mode = modeParam === "suggest" ? "suggest" : "search";
    const data = await searchDocuments({
      query,
      projectId: projectId?.trim() ? projectId : null,
      limit: Number.isFinite(limitParam) ? limitParam : 8,
      mode,
      viewerUserId: session.user.id,
    });

    // Deduplicate results by (sourceType, sourceId) for the human-facing search panel.
    // searchDocuments returns every chunk independently so the AI can find the right
    // one — but showing three chunks of the same note in the UI is confusing.
    // Keep the highest-scoring chunk per source.
    const dedupedResults = (() => {
      const best = new Map<string, typeof data.results[0]>();
      for (const item of data.results) {
        const key = `${item.type}:${item.metadata?.projectId ?? ""}:${item.url}`;
        if (!best.has(key) || item.score > best.get(key)!.score) {
          best.set(key, item);
        }
      }
      return Array.from(best.values());
    })();

    const dedupedGrouped: typeof data.grouped = {
      ticket: dedupedResults.filter((r) => r.type === "ticket"),
      commit: dedupedResults.filter((r) => r.type === "commit"),
      note: dedupedResults.filter((r) => r.type === "note"),
    };

    return NextResponse.json({
      ...data,
      results: dedupedResults,
      grouped: dedupedGrouped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
