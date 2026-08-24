import { NextRequest, NextResponse } from "next/server";
import type { SkillSearchResult } from "@/features/ai/ui/ai-workspace/lib/api-types";

const SKILLS_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
const SEARCH_TIMEOUT_MS = 15_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { query: string };
    const { query } = body;

    if (!query?.trim()) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const results = await searchSkills(query.trim());
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  const url = `${SKILLS_API_BASE}/api/search?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`skills.sh search failed: HTTP ${res.status}`);
    }

    const raw = await res.json() as {
      results?: SkillSearchResult[];
      skills?: SkillSearchResult[];
      error?: string;
    };

    if (raw.error) {
      throw new Error(raw.error);
    }

    return raw.results ?? raw.skills ?? [];
  } finally {
    clearTimeout(timeout);
  }
}
