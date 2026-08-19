/**
 * Policy Gateway（策略网关统一入口）
 *
 * Phase 3: 统一的 Policy 决策点
 * Phase 4: 审计日志持久化到数据库
 * 
 * 架构：
 * - Pi tool_call 前置拦截 → PolicyGateway.check()
 * - 三层检查：tool-policy → command-policy → path-policy
 * - 决策结果：allow（放行）/ approve（需审批）/ deny（拒绝）
 * - 审计日志：异步写入数据库（不阻塞 tool_call 执行）
 * 
 * ⚠️ 安全边界：
 * - Policy 是应用级策略，最终安全靠 Sandbox / Container
 */

import type { PolicyContext, PolicyResult, PolicyDecision } from "../subagents/types";
import { checkTool } from "./tool-policy";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-exported
import { checkCommand } from "./command-policy";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-exported
import { checkPaths } from "./path-policy";
import { prisma } from "@/shared/db/client";

// ─── 策略配置─────────────────────────────────────────────────────

interface PolicyConfig {
  /** 是否启用 Policy Gateway（默认 true） */
  enabled?: boolean;
  
  /** 是否启用 HIL 审批流（默认 true） */
  hilEnabled?: boolean;
  
  /** 审批超时时间（毫秒，默认 5 分钟） */
  approvalTimeoutMs?: number;
  
  /** 超时后的默认决策（默认 deny） */
  timeoutDecision?: PolicyDecision;
  
  /** 是否记录审计日志（默认 true） */
  auditEnabled?: boolean;
}

const DEFAULT_CONFIG: Required<PolicyConfig> = {
  enabled: true,
  hilEnabled: true,
  approvalTimeoutMs: 5 * 60 * 1000, // 5 分钟
  timeoutDecision: "deny",
  auditEnabled: true,
};

// ─── Policy Gateway 主类───────────────────────────────────────────

export class PolicyGateway {
  private config: Required<PolicyConfig>;
  private auditLog: PolicyAuditEntry[] = []; // 内存缓存（仅用于测试/调试）
  
  constructor(config?: PolicyConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * 检查 tool 调用是否允许
   * 
   * 流程：
   * 1. 检查 Policy Gateway 是否启用
   * 2. 调用 tool-policy 检查（内部会根据工具类型自动串联 command-policy 和 path-policy）
   *    - Shell 工具 → checkTool() 内部调用 checkCommand()
   *    - 文件工具 → checkTool() 内部调用 checkPaths()
   *    - 高风险工具 → checkTool() 返回 approve
   * 3. 记录审计日志
   * 4. 返回决策结果
   * 
   * 注意：三层检查（tool/command/path）已在 checkTool() 内部实现，
   *       无需在此处显式调用 checkCommand 和 checkPaths。
   */
  async check(context: PolicyContext): Promise<PolicyResult> {
    // 0. Policy Gateway 未启用 → 直接放行
    if (!this.config.enabled) {
      return {
        decision: "allow",
        reason: "Policy Gateway 已禁用",
      };
    }
    
    // 1. 调用 tool-policy（异步加载规则，会递归调用 command-policy / path-policy）
    const result = await checkTool(context);
    
    // 2. 如果需要审批，但 HIL 未启用 → 根据配置决定
    if (result.decision === "approve" && !this.config.hilEnabled) {
      return {
        decision: this.config.timeoutDecision,
        reason: `HIL 未启用，默认决策: ${this.config.timeoutDecision}`,
      };
    }
    
    // 3. 记录审计日志
    if (this.config.auditEnabled) {
      this.recordAudit(context, result);
    }
    
    return result;
  }
  
  /**
   * 记录审计日志（异步持久化到数据库）
   */
  private recordAudit(context: PolicyContext, result: PolicyResult): void {
    // 1. 同步写入内存（用于测试/调试）
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      runId: context.runId,
      userId: context.userId,
      tool: context.tool,
      command: context.command,
      filePaths: context.filePaths,
      decision: result.decision,
      reason: result.reason,
    });
    
    // 限制内存日志大小（最多保留 1000 条）
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
    
    // 2. 异步写入数据库（不阻塞 tool_call 执行）
    this.persistAuditLog(context, result).catch((error) => {
      console.error("[PolicyGateway] Failed to persist audit log:", error);
    });
  }
  
  /**
   * 持久化审计日志到数据库
   */
  private async persistAuditLog(context: PolicyContext, result: PolicyResult): Promise<void> {
    try {
      await prisma.policyAuditLog.create({
        data: {
          runId: context.runId,
          userId: context.userId,
          tool: context.tool,
          args: context.args as any,
          decision: result.decision.toUpperCase() as "ALLOW" | "APPROVE" | "DENY",
          reason: result.reason,
          command: context.command,
          filePaths: context.filePaths,
          workspace: context.workspace,
        },
      });
    } catch (error) {
      // 数据库写入失败不应阻塞 tool_call 执行，仅记录错误
      console.error("[PolicyGateway] persistAuditLog failed:", error);
    }
  }
  
  /**
   * 获取审计日志（从数据库查询）
   */
  async getAuditLog(filter?: {
    runId?: string;
    userId?: string;
    decision?: PolicyDecision;
    limit?: number;
  }): Promise<PolicyAuditEntry[]> {
    try {
      const logs = await prisma.policyAuditLog.findMany({
        where: {
          ...(filter?.runId && { runId: filter.runId }),
          ...(filter?.userId && { userId: filter.userId }),
          ...(filter?.decision && { decision: filter.decision.toUpperCase() as "ALLOW" | "APPROVE" | "DENY" }),
        },
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
      });
      
      return logs.map((log: typeof logs[number]) => ({
        timestamp: log.createdAt.toISOString(),
        runId: log.runId,
        userId: log.userId,
        tool: log.tool,
        command: log.command ?? undefined,
        filePaths: log.filePaths,
        decision: log.decision.toLowerCase() as PolicyDecision,
        reason: log.reason ?? undefined,
      }));
    } catch (error) {
      console.error("[PolicyGateway] getAuditLog failed:", error);
      // 降级到内存日志
      return this.getAuditLogFromMemory(filter);
    }
  }
  
  /**
   * 从内存获取审计日志（降级方案）
   */
  private getAuditLogFromMemory(filter?: {
    runId?: string;
    userId?: string;
    decision?: PolicyDecision;
  }): PolicyAuditEntry[] {
    if (!filter) {
      return [...this.auditLog];
    }
    
    return this.auditLog.filter((entry) => {
      if (filter.runId && entry.runId !== filter.runId) return false;
      if (filter.userId && entry.userId !== filter.userId) return false;
      if (filter.decision && entry.decision !== filter.decision) return false;
      return true;
    });
  }
  
  /**
   * 清空审计日志
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }
  
  /**
   * 更新审批状态（用户批准/拒绝后调用）
   */
  async updateApproval(logId: string, approved: boolean, approvedBy: string): Promise<void> {
    try {
      await prisma.policyAuditLog.update({
        where: { id: logId },
        data: {
          approvedAt: new Date(),
          approvedBy,
          decision: approved ? "ALLOW" : "DENY",
        },
      });
    } catch (error) {
      console.error("[PolicyGateway] updateApproval failed:", error);
      throw error;
    }
  }
  
  /**
   * 根据 runId 查找待审批的审计日志
   */
  async findPendingApproval(runId: string): Promise<string | null> {
    try {
      const log = await prisma.policyAuditLog.findFirst({
        where: {
          runId,
          decision: "APPROVE",
          approvedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });
      return log?.id ?? null;
    } catch (error) {
      console.error("[PolicyGateway] findPendingApproval failed:", error);
      return null;
    }
  }
}

// ─── 审计日志类型───────────────────────────────────────────────────

interface PolicyAuditEntry {
  timestamp: string;
  runId: string;
  userId: string;
  tool: string;
  command?: string;
  filePaths?: string[];
  decision: PolicyDecision;
  reason?: string;
}

// ─── 单例 Policy Gateway（全局共享）──────────────────────────────

let globalPolicyGateway: PolicyGateway | null = null;

/**
 * 获取全局 Policy Gateway 实例
 */
export function getPolicyGateway(config?: PolicyConfig): PolicyGateway {
  if (!globalPolicyGateway) {
    globalPolicyGateway = new PolicyGateway(config);
  }
  return globalPolicyGateway;
}

/**
 * 重置全局 Policy Gateway（仅测试用）
 */
export function resetPolicyGateway(): void {
  globalPolicyGateway = null;
}

// ─── 便捷函数：直接检查 tool 调用──────────────────────────────────

/**
 * 直接检查 tool 调用（使用全局 Policy Gateway）
 */
export async function checkToolCall(context: PolicyContext): Promise<PolicyResult> {
  const gateway = getPolicyGateway();
  return gateway.check(context);
}

// ─── 导出所有策略函数（供独立使用）────────────────────────────────

export { checkTool } from "./tool-policy";
export { checkCommand, extractCommand } from "./command-policy";
export { checkPaths, extractPaths, isSensitiveFile } from "./path-policy";
export type { PolicyConfig, PolicyAuditEntry };
