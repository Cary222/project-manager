import { NextRequest, NextResponse } from "next/server";
import { loadRules } from "@/lib/rules-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd") ?? "";
    return NextResponse.json(await loadRules(cwd));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      filePath: string;
      disableModelInvocation?: boolean;
    };
    const { filePath, disableModelInvocation } = body;

    if (!filePath) {
      return NextResponse.json(
        { error: "filePath is required" },
        { status: 400 },
      );
    }

    if (typeof disableModelInvocation !== "boolean") {
      return NextResponse.json(
        { error: "disableModelInvocation must be a boolean" },
        { status: 400 },
      );
    }

    await updateRuleDisableFlag(filePath, disableModelInvocation);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function updateRuleDisableFlag(
  filePath: string,
  disable: boolean,
): Promise<void> {
  const { readFileSync, writeFileSync } = await import("fs");
  const { parseFrontmatter, formatFrontmatterValue } = await import(
    "@/lib/frontmatter"
  );

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
