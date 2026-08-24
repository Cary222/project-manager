import { NextRequest, NextResponse } from "next/server";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd");

    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const status = await getGitStatus(cwd);
    return NextResponse.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
