/**
 * Tool Policy（工具级别策略）
 *
 * Phase 3: 针对特定 tool 的策略（tool 名称级别）
 * Phase 4 P1: 支持从数据库动态加载规则
 * 
 * 不同工具有不同的风险等级：
 * - 只读工具（read_file）：自动通过
 * - 写入工具（write_file）：检查路径
 * - Shell 工具（bash）：检查命令 + 路径
 * - 网络工具（fetch）：需要审批
 */

import type { PolicyResult, PolicyContext } from "../subagents/types";
import { checkCommand, extractCommand } from "./command-policy";
import { checkPaths, extractPaths } from "./path-policy";
import { prisma } from "@/shared/db/client";

// ─── 工具风险等级定义────────────────────────────────────────────────

type ToolRiskLevel = "safe" | "medium" | "high" | "dangerous";

interface ToolPolicy {
  risk: ToolRiskLevel;
  requiresApproval: boolean;
  description: string;
}

// ─── 默认工具策略（硬编码，用于冷启动和降级）────────────────────────

const DEFAULT_TOOL_POLICIES: Record<string, ToolPolicy> = {
  // ─── 只读工具（安全）─────────────────────────────────────
  "read_file": {
    risk: "safe",
    requiresApproval: false,
    description: "读取文件内容",
  },
  "list_directory": {
    risk: "safe",
    requiresApproval: false,
    description: "列出目录内容",
  },
  "search_files": {
    risk: "safe",
    requiresApproval: false,
    description: "搜索文件",
  },
  "get_file_info": {
    risk: "safe",
    requiresApproval: false,
    description: "获取文件信息",
  },
  
  // ─── 写入工具（中等风险）──────────────────────────────────
  "write_file": {
    risk: "medium",
    requiresApproval: false,
    description: "写入文件（需路径检查）",
  },
  "create_file": {
    risk: "medium",
    requiresApproval: false,
    description: "创建文件（需路径检查）",
  },
  "edit_file": {
    risk: "medium",
    requiresApproval: false,
    description: "编辑文件（需路径检查）",
  },
  "rename_file": {
    risk: "medium",
    requiresApproval: false,
    description: "重命名文件（需路径检查）",
  },
  
  // ─── 删除工具（高风险）───────────────────────────────────
  "delete_file": {
    risk: "high",
    requiresApproval: true,
    description: "删除文件（需要审批）",
  },
  "delete_directory": {
    risk: "high",
    requiresApproval: true,
    description: "删除目录（需要审批）",
  },
  
  // ─── Shell 工具（危险）──────────────────────────────────
  "bash": {
    risk: "dangerous",
    requiresApproval: false, // 由 command-policy 决定
    description: "执行 shell 命令（需命令检查）",
  },
  "shell": {
    risk: "dangerous",
    requiresApproval: false, // 由 command-policy 决定
    description: "执行 shell 命令（需命令检查）",
  },
  "execute": {
    risk: "dangerous",
    requiresApproval: false, // 由 command-policy 决定
    description: "执行命令（需命令检查）",
  },
  
  // ─── 网络工具（高风险）───────────────────────────────────
  "fetch": {
    risk: "high",
    requiresApproval: true,
    description: "发起网络请求（需要审批）",
  },
  "http_request": {
    risk: "high",
    requiresApproval: true,
    description: "HTTP 请求（需要审批）",
  },
  
  // ─── Git 工具（中等风险）─────────────────────────────────
  "git_commit": {
    risk: "medium",
    requiresApproval: true,
    description: "Git 提交（需要审批）",
  },
  "git_push": {
    risk: "high",
    requiresApproval: true,
    description: "Git 推送（需要审批）",
  },
};

// ─── 动态规则缓存────────────────────────────────────────────────────

let cachedPolicies: Record<string, ToolPolicy> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000; // 60 秒缓存

/**
 * 从数据库加载工具策略
 */
async function loadPoliciesFromDB(): Promise<Record<string, ToolPolicy>> {
  try {
    const rules = await prisma.policyRule.findMany({
      where: { enabled: true },
    });

    const policies: Record<string, ToolPolicy> = {};
    
    for (const rule of rules) {
      // 匹配所有 TOOL 相关的规则类型
      const isToolRule = rule.ruleType === "TOOL_WHITELIST" || 
                        rule.ruleType === "TOOL_BLACKLIST" || 
                        rule.ruleType === "TOOL_HIL";
      
      if (isToolRule && rule.targetName) {
        policies[rule.targetName] = {
          risk: mapRiskLevel(rule.riskLevel || "MEDIUM"),
          requiresApproval: rule.requiresApproval,
          description: rule.description || `工具: ${rule.targetName}`,
        };
      }
    }

    return policies;
  } catch (error) {
    console.error("[tool-policy] Failed to load policies from DB:", error);
    return {};
  }
}

/**
 * 映射数据库的 riskLevel 到 ToolRiskLevel
 */
function mapRiskLevel(dbRiskLevel: string): ToolRiskLevel {
  const mapping: Record<string, ToolRiskLevel> = {
    "SAFE": "safe",
    "MEDIUM": "medium",
    "HIGH": "high",
    "DANGEROUS": "dangerous",
  };
  return mapping[dbRiskLevel] ?? "medium";
}

/**
 * 获取工具策略（优先从数据库，降级到默认策略）
 */
async function getToolPolicies(): Promise<Record<string, ToolPolicy>> {
  const now = Date.now();
  
  // 1. 检查缓存是否有效
  if (cachedPolicies && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedPolicies;
  }
  
  // 2. 从数据库加载
  const dbPolicies = await loadPoliciesFromDB();
  
  // 3. 合并默认策略（DB 优先）
  const mergedPolicies = {
    ...DEFAULT_TOOL_POLICIES,
    ...dbPolicies,
  };
  
  // 4. 更新缓存
  cachedPolicies = mergedPolicies;
  cacheTimestamp = now;
  
  return mergedPolicies;
}

/**
 * 清除缓存（用于测试或动态更新规则后）
 */
export function clearPolicyCache(): void {
  cachedPolicies = null;
  cacheTimestamp = 0;
}

// ─── 主函数：检查 tool 调用────────────────────────────────────────

/**
 * 检查 tool 调用是否允许
 * 
 * 流程：
 * 1. 从数据库加载 tool 策略（带缓存）
 * 2. Shell 工具 → 调用 command-policy
 * 3. 文件工具 → 调用 path-policy
 * 4. 高风险工具 → 要求审批
 */
export async function checkTool(context: PolicyContext): Promise<PolicyResult> {
  const { tool, args, workspace } = context;
  
  // 1. 获取 tool 策略（从数据库加载，带缓存）
  const policies = await getToolPolicies();
  const policy = policies[tool];
  
  // 未知工具：默认需要审批
  if (!policy) {
    return {
      decision: "approve",
      reason: `未知工具，需要审批: ${tool}`,
    };
  }
  
  // 2. Shell 工具：检查命令
  if (tool === "bash" || tool === "shell" || tool === "execute") {
    const command = extractCommand(args);
    if (!command) {
      return {
        decision: "deny",
        reason: "Shell 工具缺少命令参数",
      };
    }
    return checkCommand(command);
  }
  
  // 3. 文件工具：检查路径
  if (policy.risk === "medium" || policy.risk === "high") {
    const paths = extractPaths(args);
    if (paths.length > 0) {
      const pathResult = checkPaths(paths, workspace);
      if (pathResult.decision === "deny") {
        return pathResult;
      }
    }
  }
  
  // 4. 高风险工具：要求审批
  if (policy.requiresApproval) {
    return {
      decision: "approve",
      reason: `${policy.description}`,
    };
  }
  
  // 5. 安全工具：直接通过
  return {
    decision: "allow",
    reason: `安全工具: ${policy.description}`,
  };
}

// ─── 同步版本（用于测试和向后兼容）─────────────────────────────────

export function checkToolSync(context: PolicyContext): PolicyResult {
  const { tool, args, workspace } = context;
  
  // 使用默认策略（不访问数据库）
  const policy = DEFAULT_TOOL_POLICIES[tool];
  
  if (!policy) {
    return {
      decision: "approve",
      reason: `未知工具，需要审批: ${tool}`,
    };
  }
  
  // Shell 工具：检查命令
  if (tool === "bash" || tool === "shell" || tool === "execute") {
    const command = extractCommand(args);
    if (!command) {
      return {
        decision: "deny",
        reason: "Shell 工具缺少命令参数",
      };
    }
    return checkCommand(command);
  }
  
  // 文件工具：检查路径
  if (policy.risk === "medium" || policy.risk === "high") {
    const paths = extractPaths(args);
    if (paths.length > 0) {
      const pathResult = checkPaths(paths, workspace);
      if (pathResult.decision === "deny") {
        return pathResult;
      }
    }
  }
  
  // 高风险工具：要求审批
  if (policy.requiresApproval) {
    return {
      decision: "approve",
      reason: `${policy.description}`,
    };
  }
  
  // 安全工具：直接通过
  return {
    decision: "allow",
    reason: `安全工具: ${policy.description}`,
  };
}

// ─── 辅助函数：获取工具风险等级──────────────────────────────────────

export async function getToolRiskLevel(tool: string): Promise<ToolRiskLevel> {
  const policies = await getToolPolicies();
  return policies[tool]?.risk ?? "medium";
}

export function getToolRiskLevelSync(tool: string): ToolRiskLevel {
  return DEFAULT_TOOL_POLICIES[tool]?.risk ?? "medium";
}

// ─── 辅助函数：判断是否为只读工具──────────────────────────────────

export async function isReadOnlyTool(tool: string): Promise<boolean> {
  const policies = await getToolPolicies();
  const policy = policies[tool];
  return policy?.risk === "safe";
}

export function isReadOnlyToolSync(tool: string): boolean {
  const policy = DEFAULT_TOOL_POLICIES[tool];
  return policy?.risk === "safe";
}

// ─── 辅助函数：判断是否为危险工具──────────────────────────────────

export async function isDangerousTool(tool: string): Promise<boolean> {
  const policies = await getToolPolicies();
  const policy = policies[tool];
  return policy?.risk === "dangerous" || policy?.risk === "high";
}

export function isDangerousToolSync(tool: string): boolean {
  const policy = DEFAULT_TOOL_POLICIES[tool];
  return policy?.risk === "dangerous" || policy?.risk === "high";
}
