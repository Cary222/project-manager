/**
 * Work Agent Runtime — Approval
 *
 * Human-in-the-Loop (HIL) 审批流程封装。
 * 基于 LangGraph 的 interrupt() 机制实现暂停和恢复。
 */

import { Command, interrupt } from "@langchain/langgraph";

export type ApprovalCandidate = {
  id: string;
  label: string;
  description?: string;
};

// ============================================================================
// Approval Types
// ============================================================================

export type ApprovalDecision = "approve" | "revise" | "reject";

export interface ApprovalRequest {
  title: string;
  description: string;
  candidates?: ApprovalCandidate[];
  context?: Record<string, unknown>;
}

export interface ApprovalResponse {
  decision: ApprovalDecision;
  feedback?: string;
  respondedAt: number;
}

// ============================================================================
// Approval Manager
// ============================================================================

export class ApprovalManager {
  /**
   * Request human approval.
   * This throws an interrupt, pausing the graph execution.
   */
  request(title: string, description: string, candidates?: ApprovalCandidate[]): never {
    const payload: ApprovalRequest = {
      title,
      description,
      candidates,
    };
    throw interrupt(JSON.stringify(payload));
  }

  /**
   * Resume from approval response.
   */
  resume(decision: ApprovalDecision, feedback?: string): Command<unknown> {
    return new Command({
      resume: {
        decision,
        feedback,
        respondedAt: Date.now(),
      } satisfies ApprovalResponse,
    });
  }

  /**
   * Quick approve.
   */
  approve(feedback?: string): Command<unknown> {
    return this.resume("approve", feedback);
  }

  /**
   * Quick revise.
   */
  revise(feedback: string): Command<unknown> {
    return this.resume("revise", feedback);
  }

  /**
   * Quick reject.
   */
  reject(reason?: string): Command<unknown> {
    return this.resume("reject", reason);
  }
}

// ============================================================================
// Approval Utilities
// ============================================================================

/**
 * Parse approval request from interrupt payload.
 */
export function parseApprovalPayload(payload: string): ApprovalRequest | null {
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed.title === "string" && typeof parsed.description === "string") {
      return parsed as ApprovalRequest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if payload is an approval request.
 */
export function isApprovalPayload(payload: unknown): payload is string {
  if (typeof payload !== "string") return false;
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed.title === "string" && typeof parsed.description === "string";
  } catch {
    return false;
  }
}

// ============================================================================
// Default Approval Manager Instance
// ============================================================================

export const defaultApprovalManager = new ApprovalManager();
