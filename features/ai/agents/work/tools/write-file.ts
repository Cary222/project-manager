/**
 * Write File Tool — 写报告/文档（非写代码）
 *
 * 限制写入路径，只允许写入报告目录。
 */

import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import type { ToolDefinition } from "@/features/ai/runtime/tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "@/features/ai/runtime/tool-registry";

const schema = z.object({
  path: z.string().describe("文件路径"),
  content: z.string().describe("文件内容"),
  append: z.boolean().optional().default(false).describe("是否追加模式"),
});

type WriteParams = z.infer<typeof schema>;

// 允许写入的根目录（相对于项目根目录）
const ALLOWED_WRITE_ROOTS = [
  "reports",
  "outputs",
  "weekly-reports",
  "docs",
];

/**
 * Check if a path is allowed to write.
 */
function isAllowed(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const projectRoot = process.cwd().replace(/\\/g, "/");
  const resolved = isAbsolute(path) ? path : resolve(projectRoot, path);
  const relative = resolved.replace(projectRoot, "").replace(/^\//, "");

  for (const root of ALLOWED_WRITE_ROOTS) {
    if (relative.startsWith(root + "/") || relative === root) {
      return true;
    }
  }

  return false;
}

export function createWriteFileTool(): ToolDefinition<{ bytes: number }> {
  return {
    name: "write_file",
    description: "写入报告/文档到指定路径（受限：只允许 reports/ outputs/ docs/ 目录）",
    inputSchema: schema,
    permission: "write",
    agentTypes: ["WORK"],
    async execute(ctx: ToolExecutionContext, args: unknown): Promise<ToolExecutionResult<{ bytes: number }>> {
      const params = schema.parse(args);

      if (!isAllowed(params.path)) {
        return {
          content: `禁止写入：路径不在允许目录内（${ALLOWED_WRITE_ROOTS.join(", ")}）`,
          details: { bytes: 0 },
          isError: true,
        };
      }

      try {
        let resolvedPath = params.path;
        if (!isAbsolute(resolvedPath)) {
          resolvedPath = resolve(process.cwd(), resolvedPath);
        }

        await mkdir(dirname(resolvedPath), { recursive: true });

        const mode = params.append ? "a" : "w";
        await writeFile(resolvedPath, params.content, { flag: mode });

        return {
          content: `成功写入 ${resolvedPath}（${params.content.length} bytes）`,
          details: { bytes: params.content.length },
        };
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : "写入失败",
          details: { bytes: 0 },
          isError: true,
        };
      }
    },
  };
}
