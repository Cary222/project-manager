/**
 * Work Agent — Human-in-the-Loop Protocol
 *
 * 统一协议：Conversation 和 Work 共享同一套 HIL 协议。
 * 不同点在于执行方式：
 * - Conversation: DB state + 轮询
 * - Work: LangGraph interrupt + checkpoint
 */

import type { AgentRunStatus } from "@/features/ai/runtime/types";

// ─── Action Types ─────────────────────────────────────────────────────────────

export type HumanActionType =
  | "select"      // 从候选列表中选择（如选择用户、项目）
  | "approve"     // 审批确认（如启动工作流）
  | "revise"      // 要求修订
  | "reject";     // 拒绝

// ─── Pending Human Action ─────────────────────────────────────────────────────

export interface PendingHumanAction {
  /** 唯一 ID */
  id: string;
  /** 操作类型 */
  type: HumanActionType;
  /** 标题（如"选择目标用户"） */
  title: string;
  /** 详细描述 */
  description?: string;
  /** 候选列表（用于 select 类型） */
  candidates?: HumanActionCandidate[];
  /** 相关实体类型 */
  entityType?: "user" | "ticket" | "project" | "weekly_report" | "workflow";
  /** 原始查询（用于 disambiguation） */
  query?: string;
  /** 关联的步骤 ID */
  stepId?: string;
  /** 创建时间 */
  createdAt: string;
  /** 过期时间（可选） */
  expiresAt?: string;
}

export interface HumanActionCandidate {
  id: string;
  label: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

// ─── Action Result ────────────────────────────────────────────────────────────

export interface HumanActionResult {
  actionId: string;
  type: HumanActionType;
  decision: "selected" | "approved" | "revised" | "rejected";
  selectedId?: string;       // select 类型选中的候选 ID
  selectedLabel?: string;   // select 类型选中的标签
  feedback?: string;        // revise/reject 时的反馈
  resolvedAt: string;
}

// ─── PendingHumanAction State（用于存储）─────────────────────────────────────

export interface PendingHumanActionState {
  pendingHumanAction: PendingHumanAction | null;
  lastAssistantMessage: string;
  mode: string;
  lastMentionedUser?: { id: string; name: string };
}

// ─── UI 渲染辅助 ─────────────────────────────────────────────────────────────

export type HumanActionUIType = "select" | "approve" | "revise" | "reject";

/**
 * 将 PendingHumanAction 转换为 UI 类型。
 */
export function toHumanActionUIType(action: PendingHumanAction): HumanActionUIType {
  switch (action.type) {
    case "select":
      return "select";
    case "approve":
      return "approve";
    case "revise":
      return "revise";
    case "reject":
      return "reject";
    default:
      return "approve";
  }
}

/**
 * 获取 HIL 的默认标题。
 */
export function getHumanActionTitle(type: HumanActionType, entityType?: string): string {
  switch (type) {
    case "select":
      const entityLabel: Record<string, string> = {
        user: "选择目标用户",
        ticket: "选择目标工单",
        project: "选择目标项目",
        weekly_report: "选择目标周报",
        workflow: "选择工作流",
      };
      return entityLabel[entityType ?? ""] ?? "请选择";
    case "approve":
      return "确认执行";
    case "revise":
      return "请求修订";
    case "reject":
      return "确认取消";
    default:
      return "请确认";
  }
}

// ─── Status 转换 ────────────────────────────────────────────────────────────

/**
 * 从 PendingHumanAction 推断运行时状态。
 */
export function inferRunStatus(action: PendingHumanAction | null): AgentRunStatus {
  if (!action) return "running";
  if (action.type === "select") return "waiting";
  if (action.type === "approve") return "waiting";
  if (action.type === "revise") return "waiting";
  if (action.type === "reject") return "waiting";
  return "running";
}
