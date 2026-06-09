import { NextResponse } from "next/server";
import { searchDocuments } from "@/lib/search";
import { requireSession } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    await requireSession();
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
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
