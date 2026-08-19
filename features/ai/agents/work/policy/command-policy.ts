/**
 * Command Policy（命令白名单）
 *
 * Phase 3: 基于字符串匹配的命令策略（原型）
 * 
 * ⚠️ 安全边界：
 * - Policy 是应用级策略，不能作为最终安全边界
 * - 最终安全靠 Sandbox / Container（OS 级别）
 * - 字符串匹配会被绕过（如 `bash -c 'rm -rf'`）
 */

import type { PolicyResult } from "../subagents/types";

// ─── 白名单命令（自动通过）─────────────────────────────────────────

const ALLOW_COMMANDS = new Set([
  // Git 只读命令
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git blame",
  
  // 文件查看
  "ls",
  "find",
  "cat",
  "head",
  "tail",
  "grep",
  "wc",
  "pwd",
  
  // 代码质量工具
  "npm test",
  "npm run lint",
  "npm run type-check",
  "npm run build",
  "pnpm test",
  "pnpm run lint",
  "cargo test",
  "cargo check",
  "cargo build",
  "eslint",
  "tsc --noEmit",
  
  // 包管理（只读）
  "npm list",
  "pnpm list",
  "cargo tree",
]);

// ─── 需要审批的命令（HIL）─────────────────────────────────────────

const HIL_COMMANDS = new Set([
  // 危险删除
  "rm -rf",
  "rm -r",
  "rm -f",
  
  // Git 写操作
  "git push",
  "git force-push",
  "git reset --hard",
  "git clean -f",
  "git rebase",
  
  // 权限修改
  "sudo",
  "chmod 777",
  "chmod +x",
  
  // 包安装（可能引入风险依赖）
  "npm install",
  "pnpm install",
  "cargo add",
  
  // 数据库操作
  "psql",
  "mysql",
  "mongosh",
]);

// ─── 永久拒绝的命令────────────────────────────────────────────────

const DENY_COMMANDS = new Set([
  // 强制删除 + 重置
  "git reset --hard HEAD~",
  "rm -rf /",
  "rm -rf ~",
  "rm -rf .",
  
  // 远程执行（高风险）
  "curl | sh",
  "wget | sh",
  "curl | bash",
  "wget | bash",
  
  // 系统级操作
  "shutdown",
  "reboot",
  "kill -9",
  "killall",
]);

// ─── 命令前缀白名单（用于快速判断）───────────────────────────────

const SAFE_COMMAND_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git show",
  "git blame",
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "npm test",
  "npm run",
  "pnpm test",
  "pnpm run",
  "cargo test",
  "cargo check",
  "eslint",
  "tsc",
];

// ─── 主函数：检查命令──────────────────────────────────────────────

export function checkCommand(command: string): PolicyResult {
  const trimmed = command.trim();
  
  // 1. 空命令
  if (!trimmed) {
    return { decision: "deny", reason: "空命令" };
  }
  
  // 2. 检查拒绝列表（最高优先级）
  for (const denied of Array.from(DENY_COMMANDS)) {
    if (trimmed.includes(denied)) {
      return {
        decision: "deny",
        reason: `危险命令（永久拒绝）: ${denied}`,
      };
    }
  }
  
  // 3. 检查审批列表
  for (const hilCmd of Array.from(HIL_COMMANDS)) {
    if (trimmed.includes(hilCmd)) {
      return {
        decision: "approve",
        reason: `需要审批: ${hilCmd}`,
      };
    }
  }
  
  // 4. 检查白名单（精确匹配）
  if (ALLOW_COMMANDS.has(trimmed)) {
    return {
      decision: "allow",
      reason: "白名单命令（精确匹配）",
    };
  }
  
  // 5. 检查前缀匹配（npm run xxx / git status --short）
  for (const prefix of SAFE_COMMAND_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        decision: "allow",
        reason: `白名单命令（前缀匹配: ${prefix}）`,
      };
    }
  }
  
  // 6. 默认策略：未识别命令需要审批
  return {
    decision: "approve",
    reason: `未识别命令，需要审批: ${trimmed.split(" ")[0]}`,
  };
}

// ─── 辅助函数：提取 bash tool 的命令──────────────────────────────

/**
 * 从 tool args 中提取命令字符串
 * 
 * 支持的格式：
 * - { command: "ls -la" }
 * - { cmd: "git status" }
 * - { script: "npm test" }
 */
export function extractCommand(args: Record<string, unknown>): string | null {
  if (typeof args.command === "string") return args.command;
  if (typeof args.cmd === "string") return args.cmd;
  if (typeof args.script === "string") return args.script;
  
  // 如果 args 本身是字符串（某些 tool 的设计）
  if (typeof args === "string") return args;
  
  return null;
}
