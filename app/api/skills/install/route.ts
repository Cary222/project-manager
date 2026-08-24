import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import type { SkillInstallInfo } from "@/features/ai/ui/ai-workspace/lib/api-types";

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      package: string;
      scope: "global" | "project";
      cwd?: string;
    };
    const { package: pkg, scope, cwd } = body;

    if (!pkg?.trim()) {
      return NextResponse.json({ error: "package is required" }, { status: 400 });
    }
    if (scope !== "global" && scope !== "project") {
      return NextResponse.json({ error: "scope must be 'global' or 'project'" }, { status: 400 });
    }

    await installSkill(pkg.trim(), scope, cwd);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function installSkill(
  pkg: string,
  scope: "global" | "project",
  cwd?: string,
): Promise<void> {
  const atIdx = pkg.lastIndexOf("@");
  const source = atIdx >= 0 ? pkg.slice(0, atIdx) : pkg;
  const skillName = atIdx >= 0 ? pkg.slice(atIdx + 1) : pkg;

  const args = [
    "skills",
    "add",
    source,
    "--skill",
    skillName,
    "-y",
    "--agent",
    "pi",
  ];
  if (scope === "global") args.push("-g");
  else if (cwd) {
    args.push("--cwd");
    args.push(cwd);
  }

  const { stdout, stderr } = await execFileAsync("pi", args, {
    timeout: INSTALL_TIMEOUT_MS,
    shell: false,
  });

  if (stderr && !stderr.includes("warn") && !stderr.includes("info")) {
    throw new Error(stderr.trim());
  }
}
