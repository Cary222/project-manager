import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import {
  addWorktree,
  findCurrentWorktreePath,
  listWorktrees,
  removeWorktree,
  resolveProject,
} from "@/lib/worktree";
import {
  allowFileRoot,
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
} from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";

export const dynamic = "force-dynamic";

/** Same gate as /api/files: only session cwds / project roots / explicitly
 *  allowed dirs may be inspected or mutated through this endpoint. */
async function checkCwdAllowed(cwd: string): Promise<boolean> {
  const allowedRoots = await getAllowedFileRoots();
  if (
    !isFilePathAllowed(cwd, allowedRoots) ||
    !isExistingFilePathAllowed(cwd, allowedRoots)
  ) {
    return false;
  }
  return true;
}

// GET /api/worktrees?cwd=  →  { projectRoot, projectKey, isGit, isTopLevel, currentWorktreePath, worktrees }
export async function GET(request: NextRequest) {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!(await checkCwdAllowed(cwd))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const project = await resolveProject(cwd);
    let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
    let currentWorktreePath: string | null = null;
    let isGit = true;
    try {
      // For a removed-worktree cwd (session of a deleted worktree), fall back
      // to the inferred project root so the switcher still shows the project.
      worktrees = await listWorktrees(
        existsSync(cwd) ? cwd : project.projectRoot,
      );
      currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
    } catch {
      isGit = false;
    }
    // Every listed path is a git-verified worktree of this project; allow the
    // file explorer to browse them even before they have any session (the
    // in-memory allowlist from addWorktree does not survive server restarts).
    for (const w of worktrees) allowFileRoot(w.path);
    return NextResponse.json({
      projectRoot: project.projectRoot,
      projectKey: projectIdentityKey(project.projectRoot),
      isGit,
      isTopLevel: project.isTopLevel,
      currentWorktreePath,
      worktrees,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/worktrees  body: { cwd, branch }  →  { path, branch }
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { cwd?: string; branch?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.branch || typeof body.branch !== "string") {
      return NextResponse.json(
        { error: "branch is required" },
        { status: 400 },
      );
    }
    if (!(await checkCwdAllowed(body.cwd))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!existsSync(body.cwd)) {
      return NextResponse.json(
        { error: `Directory does not exist: ${body.cwd}` },
        { status: 400 },
      );
    }

    const result = await addWorktree(body.cwd, body.branch);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE /api/worktrees  body: { cwd, path, force? }
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      cwd?: string;
      path?: string;
      force?: boolean;
    };
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.path || typeof body.path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!(await checkCwdAllowed(body.cwd))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await removeWorktree(body.cwd, body.path, body.force === true);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // git refuses to remove dirty worktrees without --force; surface that so
    // the UI can offer a force-remove confirmation.
    const dirty = /contains modified or untracked files|is dirty/i.test(
      message,
    );
    return NextResponse.json(
      { error: message, dirty },
      { status: dirty ? 409 : 400 },
    );
  }
}
