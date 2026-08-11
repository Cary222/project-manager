/**
 * Execute Command Tool — 受限 Git 命令
 *
 * 只允许安全的只读 Git 命令和特定的项目管理命令。
 * 禁止：rm, curl, ssh, pip, npm install -g 等危险命令。
 */

import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import type { ToolDefinition } from "@/features/ai/runtime/tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "@/features/ai/runtime/tool-registry";

const execAsync = promisify(exec);

const schema = z.object({
  command: z.string().describe("要执行的命令"),
  timeout: z.number().optional().default(30).describe("超时秒数"),
});

type ExecuteParams = z.infer<typeof schema>;

// 允许的命令模式（白名单）
const ALLOWED_PATTERNS = [
  // Git 只读命令
  { pattern: /^git\s+log/, description: "git log" },
  { pattern: /^git\s+diff/, description: "git diff" },
  { pattern: /^git\s+status/, description: "git status" },
  { pattern: /^git\s+show/, description: "git show" },
  { pattern: /^git\s+branch/, description: "git branch" },
  { pattern: /^git\s+remote\s+-v/, description: "git remote -v" },
  // 只读系统命令
  { pattern: /^cat\s+/, description: "cat" },
  { pattern: /^ls\s+/, description: "ls" },
  { pattern: /^find\s+.*-type\s+f/, description: "find (files only)" },
  { pattern: /^head\s+/, description: "head" },
  { pattern: /^tail\s+/, description: "tail" },
  { pattern: /^wc\s+/, description: "wc" },
  { pattern: /^grep\s+/, description: "grep" },
];

// 禁止的命令模式（黑名单）
const FORBIDDEN_PATTERNS = [
  /rm\s/,
  /curl\s/,
  /wget\s/,
  /ssh\s/,
  /pip\s/,
  /npm\s+install\s+-g/,
  /yarn\s+global/,
  /sudo\s/,
  /chmod\s+777/,
  /eval\s/,
  /exec\s/,
  /;\s*rm/,
  /\|\s*rm/,
  /&\s*rm/,
];

function isAllowed(command: string): { allowed: boolean; reason?: string } {
  // Check forbidden patterns first
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `禁止执行：${command}` };
    }
  }

  // Check allowed patterns
  for (const { pattern } of ALLOWED_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `命令不在白名单内：` + command };
}

export function createExecuteCommandTool(): ToolDefinition<{ exitCode: number; stdout: string; stderr: string }> {
  return {
    name: "execute_command",
    description: "执行受限命令（只允许 git log/diff/status, cat, ls 等）",
    inputSchema: schema,
    permission: "execute",
    agentTypes: ["WORK"],
    async execute(ctx: ToolExecutionContext, args: unknown): Promise<ToolExecutionResult<{ exitCode: number; stdout: string; stderr: string }>> {
      const params = schema.parse(args);
      const check = isAllowed(params.command);

      if (!check.allowed) {
        return {
          content: check.reason ?? "命令不允许执行",
          details: { exitCode: -1, stdout: "", stderr: check.reason ?? "" },
          isError: true,
        };
      }

      try {
        const { stdout, stderr } = await execAsync(params.command, {
          timeout: params.timeout * 1000,
          cwd: process.cwd(),
          maxBuffer: 1024 * 1024, // 1MB max
        });

        return {
          content: stdout || "(empty output)",
          details: { exitCode: 0, stdout, stderr },
        };
      } catch (error) {
        const err = error as { code?: number; message?: string; stdout?: string; stderr?: string };
        return {
          content: err.message ?? "命令执行失败",
          details: {
            exitCode: err.code ?? -1,
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? "",
          },
          isError: true,
        };
      }
    },
  };
}
