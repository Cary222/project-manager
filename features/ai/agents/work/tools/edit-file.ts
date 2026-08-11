/**
 * Edit File Tool — 受限编辑（基于精确替换）
 *
 * 只允许精确文本替换，不允许正则或模糊匹配。
 */

import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import type { ToolDefinition } from "@/features/ai/runtime/tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "@/features/ai/runtime/tool-registry";

const schema = z.object({
  path: z.string().describe("文件路径"),
  oldText: z.string().min(1).describe("要替换的精确文本"),
  newText: z.string().describe("替换后的文本"),
});

type EditParams = z.infer<typeof schema>;

export function createEditFileTool(): ToolDefinition<{ changed: boolean }> {
  return {
    name: "edit_file",
    description: "编辑文件（基于精确文本替换，不允许正则）",
    inputSchema: schema,
    permission: "write",
    agentTypes: ["WORK"],
    async execute(ctx: ToolExecutionContext, args: unknown): Promise<ToolExecutionResult<{ changed: boolean }>> {
      const params = schema.parse(args);

      try {
        const resolvedPath = resolve(process.cwd(), params.path);
        let content = await readFile(resolvedPath, "utf-8");

        if (!content.includes(params.oldText)) {
          return {
            content: `未找到要替换的文本：\n${params.oldText}`,
            details: { changed: false },
            isError: true,
          };
        }

        // Count occurrences (should be exactly 1 for safe editing)
        const occurrences = (content.match(new RegExp(escapeRegex(params.oldText), "g")) || []).length;
        if (occurrences > 1) {
          return {
            content: `文本出现 ${occurrences} 次，请提供更唯一的上下文`,
            details: { changed: false },
            isError: true,
          };
        }

        content = content.replace(params.oldText, params.newText);
        await writeFile(resolvedPath, content, "utf-8");

        return {
          content: `成功修改 ${resolvedPath}`,
          details: { changed: true },
        };
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : "编辑失败",
          details: { changed: false },
          isError: true,
        };
      }
    },
  };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
