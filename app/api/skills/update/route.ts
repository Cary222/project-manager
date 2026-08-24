import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import type { SkillInstallInfo, SkillInfo } from "@/features/ai/ui/ai-workspace/lib/api-types";
import type { SkillsResponse } from "@/features/ai/ui/ai-workspace/lib/api-types";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { skillUpdateKey, buildSkillUpdateArgs } from "@/lib/skill-updates";

const execFileAsync = promisify(execFile);
const UPDATE_TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd: string;
      package: string;
      scope: "global" | "project";
    };
    const { cwd, package: pkg, scope } = body;

    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!pkg?.trim()) {
      return NextResponse.json({ error: "package is required" }, { status: 400 });
    }
    if (scope !== "global" && scope !== "project") {
      return NextResponse.json({ error: "scope must be 'global' or 'project'" }, { status: 400 });
    }

    // Find the installed skill info from the current skill list
    const skillsData = await loadSkillsWithInstallInfo(cwd);
    const skill = skillsData.skills.find((s) => s.install?.package === pkg && s.install.scope === scope);
    if (!skill?.install) {
      return NextResponse.json({ error: "Skill not found in current list" }, { status: 404 });
    }

    const updatedSkill = await updateSkill(skill, cwd);
    return NextResponse.json({ success: true, skill: updatedSkill });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function updateSkill(
  skill: SkillInfo,
  cwd: string,
): Promise<SkillInfo> {
  const install = skill.install!;

  // Build the pi skills add command from the install info
  const args = buildSkillUpdateArgs(install);

  const { stdout, stderr } = await execFileAsync("pi", args, {
    cwd: install.scope === "project" ? cwd : undefined,
    timeout: UPDATE_TIMEOUT_MS,
    shell: false,
  });

  if (stderr && !stderr.includes("warn") && !stderr.includes("info")) {
    throw new Error(stderr.trim());
  }

  // Re-read the updated skill from the skill list to get the new version hash
  const updatedData = await loadSkillsWithInstallInfo(cwd);
  const updated = updatedData.skills.find(
    (s) => s.name === skill.name && s.filePath === skill.filePath,
  );
  if (!updated) {
    throw new Error("Failed to read updated skill after install");
  }

  return updated;
}
