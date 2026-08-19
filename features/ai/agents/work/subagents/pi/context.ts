/**
 * 运行时上下文注入
 *
 * 在 workspace 创建 .projecthub/AGENT_CONTEXT.md，
 * 注入当前任务信息给 Pi Agent。
 *
 * 不覆盖项目原有的 AGENTS.md。
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { SubAgentInput } from "../types";

const PROJECTHUB_DIR = ".projecthub";
const CONTEXT_FILE = "AGENT_CONTEXT.md";

/**
 * 注入运行时上下文到 workspace
 *
 * 创建 .projecthub/AGENT_CONTEXT.md，内容包含：
 * - 当前任务（prompt）
 * - 用户身份（userId / userName）
 * - workspace 路径
 * - runId
 */
export async function injectRuntimeContext(
  input: SubAgentInput,
  metadata: {
    runId: string;
    userId: string;
    userName: string;
  }
): Promise<void> {
  const contextDir = path.join(input.workspace, PROJECTHUB_DIR);
  const contextFile = path.join(contextDir, CONTEXT_FILE);

  const contextContent = generateContextContent(input, metadata);

  try {
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(contextFile, contextContent, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to inject runtime context: ${message}`);
  }
}

/**
 * 生成 AGENT_CONTEXT.md 内容
 */
function generateContextContent(
  input: SubAgentInput,
  metadata: {
    runId: string;
    userId: string;
    userName: string;
  }
): string {
  const now = new Date().toISOString();

  return `# ProjectHub Runtime Context
> ⚠️ 此文件由系统自动生成，请勿手动修改

## Session Info

| Field | Value |
|-------|-------|
| Run ID | \`${metadata.runId}\` |
| User ID | \`${metadata.userId}\` |
| User Name | ${metadata.userName} |
| Workspace | \`${input.workspace}\` |
| Generated At | ${now} |

## Current Task

\`\`\`
${input.prompt}
\`\`\`

## Context Files

${input.contextFiles?.length ? input.contextFiles.map((f) => `- \`${f}\``).join("\n") : "_None_"}

## Notes

- 此文件是运行时上下文，不影响项目原有 AGENTS.md
- Pi Agent 读取此文件获取当前任务信息
- 任务完成后可安全删除此目录
`;
}

/**
 * 清理运行时上下文
 */
export async function cleanupRuntimeContext(workspace: string): Promise<void> {
  const contextDir = path.join(workspace, PROJECTHUB_DIR);

  try {
    await fs.rm(contextDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * 获取运行时上下文文件路径
 */
export function getContextFilePath(workspace: string): string {
  return path.join(workspace, PROJECTHUB_DIR, CONTEXT_FILE);
}
