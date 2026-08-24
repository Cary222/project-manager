/**
 * WorkEvent 适配器：Pi Event → UI WorkEvent 翻译层
 *
 * 将 SubAgentEvent 转换为 UI 层可消费的 WorkEvent 格式。
 */

import type { SubAgentEvent } from "@/features/ai/agents/work/subagents/types";

/**
 * UI 层 WorkEvent 类型
 */
export interface WorkEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * 解析 SSE 原始数据的返回类型
 */
export interface ParsedSSEEvent {
  type: string;
  payload: unknown;
}

/**
 * 解析 SSE data 行
 */
export function parseSSEEvent(data: string): ParsedSSEEvent | null {
  try {
    const parsed = JSON.parse(data) as { type?: string; payload?: unknown };
    if (!parsed.type) return null;
    return { type: parsed.type, payload: parsed.payload };
  } catch {
    return null;
  }
}

/**
 * WorkEvent 适配器
 *
 * 将 SubAgentEvent 转换为 UI 层可消费的 WorkEvent 格式。
 */
export class WorkEventAdapter {
  /**
   * 将 SubAgentEvent 翻译为 WorkEvent
   */
  translateFromSubAgent(subAgentEvent: SubAgentEvent): WorkEvent {
    const base = { timestamp: Date.now() };

    switch (subAgentEvent.type) {
      case "run_started":
        return {
          ...base,
          type: "pi_run_started",
          payload: {
            runId: subAgentEvent.runId,
            sessionId: subAgentEvent.sessionId,
          },
        };

      case "assistant_message":
        return {
          ...base,
          type: "pi_assistant_message",
          payload: {
            content: subAgentEvent.content,
            delta: subAgentEvent.delta,
          },
        };

      case "tool_call":
        return {
          ...base,
          type: "pi_tool_call",
          payload: {
            tool: subAgentEvent.tool,
            args: subAgentEvent.args,
            callId: subAgentEvent.callId,
            eventId: subAgentEvent.eventId,
          },
        };

      case "tool_result":
        return {
          ...base,
          type: "pi_tool_result",
          payload: {
            callId: subAgentEvent.callId,
            result: subAgentEvent.result,
            success: subAgentEvent.success,
          },
        };

      case "tool_error":
        return {
          ...base,
          type: "pi_tool_error",
          payload: {
            callId: subAgentEvent.callId,
            error: subAgentEvent.error,
          },
        };

      case "approval_required":
        return {
          ...base,
          type: "pi_approval_required",
          payload: {
            callId: subAgentEvent.callId,
            tool: subAgentEvent.tool,
            args: subAgentEvent.args,
            reason: subAgentEvent.reason,
          },
        };

      case "progress":
        return {
          ...base,
          type: "pi_progress",
          payload: {
            message: subAgentEvent.message,
            percent: subAgentEvent.percent,
          },
        };

      case "error":
        return {
          ...base,
          type: "pi_error",
          payload: {
            message: subAgentEvent.message,
          },
        };

      case "run_completed":
        return {
          ...base,
          type: "pi_run_completed",
          payload: {
            result: subAgentEvent.result,
          },
        };

      default:
        return {
          ...base,
          type: "pi_unknown",
          payload: subAgentEvent as Record<string, unknown>,
        };
    }
  }

  /**
   * 将 SSE 原始事件（来自 /api/ai/work/run）翻译为 WorkEvent
   *
   * SSE 事件类型映射：
   * - pi_assistant_message → pi_assistant_message
   * - pi_tool_call → pi_tool_call
   * - pi_tool_result → pi_tool_result
   * - pi_tool_error → pi_tool_error
   * - pi_approval_required → pi_approval_required
   * - pi_progress → pi_progress
   * - pi_error → pi_error
   * - pi_run_completed → pi_run_completed
   * - pi_run_started → pi_run_started
   */
  translateFromSSE(sseEvent: ParsedSSEEvent): WorkEvent {
    const base = { timestamp: Date.now() };
    const { type, payload } = sseEvent;
    const p = payload as Record<string, unknown>;

    switch (type) {
      // 后端原生事件（无 pi_ 前缀）→ 直接透传
      case "run_started":
      case "run_completed":
      case "error":
        return { ...base, type: `pi_${type}`, payload: p };

      case "dispatch_result":
      case "workflow_progress":
      case "state_update":
        return { ...base, type, payload: p };

      // Pi SubAgent 事件（有 pi_ 前缀）
      case "pi_run_started":
        return { ...base, type: "pi_run_started", payload: p };

      case "pi_session_started":
        return { ...base, type: "pi_session_started", payload: p };

      case "pi_assistant_message":
        return {
          ...base,
          type: "pi_assistant_message",
          payload: p,
        };

      case "pi_tool_call":
        return {
          ...base,
          type: "pi_tool_call",
          payload: {
            tool: p.tool,
            args: p.args,
            callId: p.callId,
            eventId: p.eventId,
          },
        };

      case "pi_tool_result":
        return {
          ...base,
          type: "pi_tool_result",
          payload: {
            callId: p.callId,
            result: p.result,
            success: p.success,
          },
        };

      case "pi_tool_error":
        return {
          ...base,
          type: "pi_tool_error",
          payload: {
            callId: p.callId,
            error: p.error,
          },
        };

      case "pi_approval_required":
        return {
          ...base,
          type: "pi_approval_required",
          payload: {
            callId: p.callId,
            tool: p.tool,
            args: p.args,
            reason: p.reason,
          },
        };

      case "pi_progress":
        return {
          ...base,
          type: "pi_progress",
          payload: {
            message: p.message,
            percent: p.percent,
          },
        };

      case "pi_error":
        return {
          ...base,
          type: "pi_error",
          payload: {
            message: p.message,
          },
        };

      case "pi_run_completed":
        return {
          ...base,
          type: "pi_run_completed",
          payload: {
            result: p.result,
          },
        };

      default:
        return { ...base, type: "pi_unknown", payload: p ?? {} };
    }
  }
}

/** 单例导出 */
export const workEventAdapter = new WorkEventAdapter();
