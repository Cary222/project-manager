import { NextRequest, NextResponse } from "next/server";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") ?? "";
    const data = await loadSkillsWithInstallInfo(cwd);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      filePath: string;
      disableModelInvocation?: boolean;
    };
    const { filePath, disableModelInvocation } = body;

    if (!filePath) {
      return NextResponse.json({ error: "filePath is required" }, { status: 400 });
    }

    if (typeof disableModelInvocation !== "boolean") {
      return NextResponse.json({ error: "disableModelInvocation must be a boolean" }, { status: 400 });
    }

    await updateSkillDisableFlag(filePath, disableModelInvocation);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function updateSkillDisableFlag(filePath: string, disable: boolean): Promise<void> {
  const { readFileSync, writeFileSync } = await import("fs");
  const { parseFrontmatter, formatFrontmatterValue } = await import("@/lib/frontmatter");
  const { dirname } = await import("path");

  const content = readFileSync(filePath, "utf8");
  const { data, rest } = parseFrontmatter(content);

  const updatedData = { ...data, "disable-model-invocation": disable };
  const yamlLines = Object.entries(updatedData).map(([key, value]) => {
    const formatted = formatFrontmatterValue(value);
    return `${key}: ${formatted}`;
  });
  const yamlBlock = `---\n${yamlLines.join("\n")}\n---`;

  writeFileSync(filePath, `${yamlBlock}\n${rest}`, "utf8");
}
