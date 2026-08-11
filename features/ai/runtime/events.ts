/**
 * Runtime Events — Runtime 通用事件封装
 *
 * 这些事件与 LangGraph 的 interrupt/Command 机制配合使用，
 * 用于实现 Human-in-the-Loop (HIL) 审批流程。
 */

import { Command, interrupt } from "@langchain/langgraph";

// ============================================================================
// Runtime Event Emitter
// ============================================================================

export type RuntimeEventSink = (event: RuntimeEvent) => void | Promise<void>;

export type RuntimeEvent =
  | { type: "run_start"; runId: string; workflowType: string }
  | { type: "run_end"; runId: string; status: string; summary?: string }
  | { type: "step_start"; stepId: string; stepLabel: string }
  | { type: "step_end"; stepId: string; stepLabel: string; result?: unknown }
  | { type: "approval_request"; title: string; description: string }
  | { type: "approval_received"; decision: "approve" | "revise" | "reject"; feedback?: string }
  | { type: "error"; message: string }
  | { type: "tool_call"; toolName: string; args: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; result: unknown; isError?: boolean };

// ============================================================================
// Runtime Event Emitter Class
// ============================================================================

export class RuntimeEventEmitter {
  private sinks: Set<RuntimeEventSink> = new Set();

  constructor(initialSink?: RuntimeEventSink) {
    if (initialSink) {
      this.sinks.add(initialSink);
    }
  }

  subscribe(sink: RuntimeEventSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  emit(event: RuntimeEvent): void {
    for (const sink of this.sinks) {
      try {
        const result = sink(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error("[RuntimeEventEmitter] async sink error:", err);
          });
        }
      } catch (err) {
        console.error("[RuntimeEventEmitter] sink error:", err);
      }
    }
  }

  emitStart(runId: string, workflowType: string): void {
    this.emit({ type: "run_start", runId, workflowType });
  }

  emitEnd(runId: string, status: string, summary?: string): void {
    this.emit({ type: "run_end", runId, status, summary });
  }

  emitStepStart(stepId: string, stepLabel: string): void {
    this.emit({ type: "step_start", stepId, stepLabel });
  }

  emitStepEnd(stepId: string, stepLabel: string, result?: unknown): void {
    this.emit({ type: "step_end", stepId, stepLabel, result });
  }

  emitApprovalRequest(title: string, description: string): void {
    this.emit({ type: "approval_request", title, description });
  }

  emitApprovalReceived(decision: "approve" | "revise" | "reject", feedback?: string): void {
    this.emit({ type: "approval_received", decision, feedback });
  }

  emitError(message: string): void {
    this.emit({ type: "error", message });
  }

  emitToolCall(toolName: string, args: Record<string, unknown>): void {
    this.emit({ type: "tool_call", toolName, args });
  }

  emitToolResult(toolName: string, result: unknown, isError?: boolean): void {
    this.emit({ type: "tool_result", toolName, result, isError });
  }
}

// ============================================================================
// HIL Interruption Helpers
// ============================================================================

/**
 * Request human approval via LangGraph interrupt.
 * This pauses execution and waits for human input.
 */
export function requestApproval(
  title: string,
  description: string,
  candidates?: { id: string; label: string; summary: string }[]
): never {
  const resumeData = {
    title,
    description,
    candidates,
    requestedAt: Date.now(),
  };
  throw interrupt(JSON.stringify(resumeData));
}

/**
 * Resume from human approval.
 */
export function resumeFromApproval(
  decision: "approve" | "revise" | "reject",
  feedback?: string
): Command<unknown> {
  return new Command({
    resume: {
      decision,
      feedback,
      respondedAt: Date.now(),
    },
  });
}

// ============================================================================
// Event Utilities
// ============================================================================

/**
 * Convert RuntimeEvent to SSE-serializable format.
 */
export function serializeEvent(event: RuntimeEvent): Record<string, unknown> {
  return { ...event };
}

/**
 * Parse interrupt payload back to approval request.
 */
export function parseApprovalRequest(payload: string): {
  title: string;
  description: string;
  candidates?: { id: string; label: string; summary: string }[];
  requestedAt: number;
} | null {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
