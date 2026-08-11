/**
 * Read Resource Tool — 受限读文件
 *
 * 限制读取范围，禁止访问 .env / node_modules / .git 等敏感目录。
 */

import { z } from "zod";
import { readFile } from "fs/promises";
import { join, isAbsolute, resolve } from "path";
import type { ToolDefinition } from "@/features/ai/runtime/tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "@/features/ai/runtime/tool-registry";

const READ_FORBIDDEN = [
  ".env",
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".netrc",
];

const READ_RESTRICTED = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
];

const schema = z.object({
  path: z.string().describe("文件路径"),
  offset: z.number().optional().describe("起始行号（1-indexed）"),
  limit: z.number().optional().default(500).describe("最大读取行数"),
});

type ReadParams = z.infer<typeof schema>;

/**
 * Check if a path is allowed to read.
 */
function isAllowed(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");

  for (const forbidden of READ_FORBIDDEN) {
    if (normalized.includes(forbidden)) return false;
  }

  for (const restricted of READ_RESTRICTED) {
    const pattern = `/${restricted}/`;
    if (normalized.includes(pattern)) return false;
  }

  return true;
}

export function createReadResourceTool(): ToolDefinition<{ lines: number; truncated: boolean }> {
  return {
    name: "read_resource",
    description: "读取文件内容（受限：禁止 .env / node_modules / .git）",
    inputSchema: schema,
    permission: "read",
    agentTypes: ["WORK"],
    async execute(ctx: ToolExecutionContext, args: unknown): Promise<ToolExecutionResult<{ lines: number; truncated: boolean }>> {
      const params = schema.parse(args);

      if (!isAllowed(params.path)) {
        return {
          content: `禁止访问：路径包含敏感目录`,
          details: { lines: 0, truncated: false },
          isError: true,
        };
      }

      try {
        let resolvedPath = params.path;
        if (!isAbsolute(resolvedPath)) {
          resolvedPath = resolve(process.cwd(), resolvedPath);
        }

        const content = await readFile(resolvedPath, "utf-8");
        const lines = content.split("\n");

        const start = (params.offset ?? 1) - 1;
        const end = start + params.limit;
        const slice = lines.slice(start, end);
        const truncated = lines.length > params.limit;

        return {
          content: slice.join("\n"),
          details: {
            lines: slice.length,
            truncated,
          },
        };
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : "读取失败",
          details: { lines: 0, truncated: false },
          isError: true,
        };
      }
    },
  };
}
