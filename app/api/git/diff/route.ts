import { NextRequest, NextResponse } from "next/server";
import { getGitFileDiff } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd")?.trim() ?? "";
    const filePath = searchParams.get("path")?.trim() ?? "";

    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!filePath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const diff = await getGitFileDiff(cwd, filePath);
    return NextResponse.json(diff);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
