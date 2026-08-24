import { NextRequest, NextResponse } from "next/server";
import { checkSkillUpdate, checkSkillUpdates } from "@/lib/skill-updates";
import type { SkillInstallInfo, SkillUpdateResult } from "@/features/ai/ui/ai-workspace/lib/api-types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      package?: string;
      scope?: "global" | "project";
      installs?: SkillInstallInfo[];
    };

    // Single skill check
    if (body.package && body.scope) {
      const install: SkillInstallInfo = {
        package: body.package,
        scope: body.scope,
        source: "",
        canCheckForUpdates: true,
      };
      const result = await checkSkillUpdate(install);
      return NextResponse.json({ updates: [result] });
    }

    // Bulk check: cwd is provided, use the install info from the lock file
    if (body.installs && Array.isArray(body.installs)) {
      const results = await checkSkillUpdates(body.installs);
      return NextResponse.json({ updates: results });
    }

    return NextResponse.json(
      { error: "Either (package + scope) or (installs[]) must be provided" },
      { status: 400 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
