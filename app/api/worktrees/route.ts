import { NextRequest, NextResponse } from "next/server";
import {
  addWorktree,
  invalidateProjectCache,
  listWorktrees,
  removeWorktree,
} from "@/lib/worktree";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd: string; branch: string };
    const { cwd, branch } = body;

    if (!cwd || !branch) {
      return NextResponse.json({ error: "cwd and branch are required" }, { status: 400 });
    }

    const result = await addWorktree(cwd, branch);
    invalidateProjectCache();
    return NextResponse.json({ path: result.path, branch: result.branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd");

    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }

    const worktrees = await listWorktrees(cwd);
    return NextResponse.json({ worktrees });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// DELETE /api/worktrees  body: { cwd, path, force? }
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as { cwd: string; path: string; force?: boolean };
    const { cwd, path: targetPath, force } = body;

    if (!cwd || !targetPath) {
      return NextResponse.json({ error: "cwd and path are required" }, { status: 400 });
    }

    await removeWorktree(cwd, targetPath, force === true);
    invalidateProjectCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
