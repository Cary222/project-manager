import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parseFrontmatter } from "@/lib/frontmatter";
import type { RuleInfo, RuleScope, RulesResponse } from "@/lib/api-types";

const RULE_EXTENSIONS = new Set([".md", ".mdc"]);

function scanRulesDir(dir: string, scope: RuleScope): RuleInfo[] {
  if (!existsSync(dir)) return [];
  const out: RuleInfo[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if (!RULE_EXTENSIONS.has(ext)) continue;
      try {
        const content = readFileSync(p, "utf8");
        const { data, rest } = parseFrontmatter(content);
        out.push({
          scope,
          path: p,
          name: entry.name.replace(/\.(md|mdc)$/i, ""),
          description:
            typeof data?.description === "string"
              ? data.description
              : undefined,
          alwaysApply:
            data?.alwaysApply === true || data?.alwaysApply === "true",
          globs: (data?.globs as string | string[] | undefined) ?? undefined,
          disableModelInvocation:
            data?.["disable-model-invocation"] === true ||
            data?.["disable-model-invocation"] === "true",
          content: rest.trimStart(),
        });
      } catch {
        // 跳过不可读文件
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadRules(cwd: string): Promise<RulesResponse> {
  const globalRules = scanRulesDir(
    join(homedir(), ".cursor", "rules"),
    "global",
  );
  const projectRules = cwd
    ? scanRulesDir(join(cwd, ".cursor", "rules"), "project")
    : [];
  return { rules: [...projectRules, ...globalRules] };
}
