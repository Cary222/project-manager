/**
 * Path Policy（路径黑名单）
 *
 * Phase 3: 防止 Pi 访问敏感路径或逃出 workspace
 * 
 * ⚠️ 安全原则：
 * - 使用 path.relative() 判断是否在 workspace 内（不用 startsWith）
 * - 阻止访问 .ssh / .env / credentials 等敏感文件
 * - 阻止路径遍历攻击（.. / node_modules/../..）
 */

import * as path from "path";
import type { PolicyResult } from "../subagents/types";

// ─── 受保护的路径模式────────────────────────────────────────────────

const PROTECTED_PATTERNS = [
  // 密钥与凭证
  /\.ssh\//,
  /\.env$/,
  /\.env\./,
  /credential/i,
  /secret/i,
  /\.key$/,
  /\.pem$/,
  /\.pfx$/,
  
  // 配置文件（包含敏感信息）
  /\.npmrc$/,
  /\.yarnrc/,
  /\.git\/config$/,
  
  // 系统文件
  /\/etc\/passwd$/,
  /\/etc\/shadow$/,
  
  // 路径遍历攻击特征
  /node_modules\/\.\./,
  /\.git\/\.\./,
  /\.\.\/\.\./,  // ../..
];

// ─── 受保护的目录（完全禁止访问）──────────────────────────────────

const PROTECTED_DIRS = new Set([
  ".ssh",
  ".gnupg",
  ".aws",
  ".gcloud",
  ".docker",
  "node_modules/..",  // 路径遍历
]);

// ─── 主函数：检查路径列表───────────────────────────────────────────

/**
 * 检查 tool 调用涉及的文件路径
 * 
 * @param paths - 文件路径列表（可能是相对路径或绝对路径）
 * @param workspace - workspace 根目录（绝对路径）
 * @returns PolicyResult
 */
export function checkPaths(
  paths: string[],
  workspace: string
): PolicyResult {
  if (paths.length === 0) {
    return { decision: "allow", reason: "无路径参数" };
  }
  
  for (const targetPath of paths) {
    // 1. 转换为绝对路径
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(workspace, targetPath);
    
    // 2. 判断是否在 workspace 内（安全方式）
    const relativePath = path.relative(workspace, absolutePath);
    const isInsideWorkspace = 
      !relativePath.startsWith("..") && 
      !path.isAbsolute(relativePath);
    
    if (!isInsideWorkspace) {
      return {
        decision: "deny",
        reason: `路径越出 workspace: ${targetPath}`,
      };
    }
    
    // 3. 检查受保护的模式
    for (const pattern of PROTECTED_PATTERNS) {
      if (pattern.test(absolutePath) || pattern.test(targetPath)) {
        return {
          decision: "deny",
          reason: `禁止访问敏感路径: ${targetPath}`,
        };
      }
    }
    
    // 4. 检查受保护的目录
    const segments = relativePath.split(path.sep);
    for (const segment of segments) {
      if (PROTECTED_DIRS.has(segment)) {
        return {
          decision: "deny",
          reason: `禁止访问受保护目录: ${segment}`,
        };
      }
    }
  }
  
  return { decision: "allow", reason: "路径检查通过" };
}

// ─── 辅助函数：从 tool args 提取路径──────────────────────────────

/**
 * 从 tool args 中提取文件路径
 * 
 * 支持的格式：
 * - { path: "src/index.ts" }
 * - { paths: ["src/a.ts", "src/b.ts"] }
 * - { file: "README.md" }
 * - { files: ["a.txt", "b.txt"] }
 * - { target: "dist/output.js" }
 */
export function extractPaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  
  // 单个路径
  if (typeof args.path === "string") {
    paths.push(args.path);
  }
  if (typeof args.file === "string") {
    paths.push(args.file);
  }
  if (typeof args.target === "string") {
    paths.push(args.target);
  }
  if (typeof args.source === "string") {
    paths.push(args.source);
  }
  if (typeof args.destination === "string") {
    paths.push(args.destination);
  }
  
  // 路径数组
  if (Array.isArray(args.paths)) {
    paths.push(...args.paths.filter((p): p is string => typeof p === "string"));
  }
  if (Array.isArray(args.files)) {
    paths.push(...args.files.filter((f): f is string => typeof f === "string"));
  }
  
  return paths;
}

// ─── 辅助函数：检查是否为敏感文件扩展名───────────────────────────

const SENSITIVE_EXTENSIONS = new Set([
  ".env",
  ".key",
  ".pem",
  ".pfx",
  ".p12",
  ".jks",
  ".keystore",
  ".crt",
  ".cer",
  ".der",
]);

export function isSensitiveFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SENSITIVE_EXTENSIONS.has(ext);
}
