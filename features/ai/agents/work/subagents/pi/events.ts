/**
 * Pi 原生事件 → SubAgentEvent 翻译层
 *
 * Phase 2: Mock 实现，返回固定事件流用于测试
 * Phase 3: 接入真实 Pi SDK 事件（架构上已准备好）
 * Phase 5: 完整事件映射 - 支持 Pi SDK 0.84.2 的所有事件类型
 * 
 * Pi SDK 事件类型参考：
 * - AgentMessageEvent: agent 输出消息
 * - ToolCallEvent: agent 调用工具
 * - ToolResultEvent: 工具执行结果
 * - ErrorEvent: 执行错误
 * - SessionStartedEvent: session 启动
 * - SessionCompletedEvent: session 完成
 * - ProgressEvent: 执行进度
 * - ApprovalRequiredEvent: HIL 审批请求
 */

import type { PiEvent, SubAgentEvent } from "../types";

/**
 * 将 Pi 原生事件流翻译为 SubAgentEvent
 *
 * Pi 原生事件映射：
 * - assistant_message → assistant_message
 * - tool_call → tool_call
 * - tool_result / tool_execution_end → tool_result
 * - error → error / tool_error
 * - run_completed → run_completed
 *
 * Phase 2: 返回 mock 事件流（用于验证架构）
 * Phase 3: 可接入真实 Pi SDK 事件流
 */
export function translateEvents(
  piEvents: AsyncIterable<PiEvent> | null,
  runId: string
): AsyncIterable<SubAgentEvent> {
  // Phase 3: 如果传入了真实 Pi 事件流，则进行翻译
  if (piEvents) {
    return translatePiEventStream(piEvents, runId);
  }
  
  // Phase 2/3: 返回 mock 事件流（用于测试或 Pi SDK 未接入时）
  return createMockEventStream(runId);
}

/**
 * 翻译真实的 Pi 事件流（Phase 3）
 */
async function* translatePiEventStream(
  piEvents: AsyncIterable<PiEvent>,
  runId: string
): AsyncGenerator<SubAgentEvent> {
  for await (const piEvent of piEvents) {
    const translated = translateSingleEvent(piEvent, runId);
    if (translated) {
      yield translated;
    }
  }
}

/**
 * 创建 Mock 事件流（Phase 2 测试用）
 *
 * 返回一个模拟的 coding agent 执行过程：
 * 1. run_started
 * 2. assistant_message (thinking)
 * 3. tool_call (read file)
 * 4. tool_result
 * 5. assistant_message (plan)
 * 6. tool_call (edit)
 * 7. tool_result
 * 8. run_completed
 */
function createMockEventStream(runId: string): AsyncIterable<SubAgentEvent> {
  const sessionId = `pi-session-${runId}`;
  const events: SubAgentEvent[] = [
    { type: "run_started", runId, sessionId },
    {
      type: "assistant_message",
      runId,
      content: "我收到了这个重构任务。让我先查看项目结构和相关代码。",
      delta: "我收到了这个重构任务",
    },
    {
      type: "tool_call",
      runId,
      eventId: "evt-1",
      tool: "read",
      args: { path: "features/ticket/model.ts" },
      callId: "call-1",
    },
    {
      type: "tool_result",
      runId,
      callId: "call-1",
      result: "// ... file content ...",
      success: true,
    },
    {
      type: "assistant_message",
      runId,
      content: "我看到了 ticket 模块的代码结构。现在开始进行重构...",
      delta: "我看到了 ticket 模块的代码结构",
    },
    {
      type: "tool_call",
      runId,
      eventId: "evt-2",
      tool: "edit",
      args: {
        path: "features/ticket/model.ts",
        oldString: "// TODO: add validation",
        newString: "// TODO: add validation\n// Phase 2: Extended with schema validation",
      },
      callId: "call-2",
    },
    {
      type: "tool_result",
      runId,
      callId: "call-2",
      result: "已修改文件",
      success: true,
    },
    {
      type: "progress",
      runId,
      message: "重构完成，正在验证...",
      percent: 90,
    },
    {
      type: "tool_call",
      runId,
      eventId: "evt-3",
      tool: "bash",
      args: { command: "npm run lint" },
      callId: "call-3",
    },
    {
      type: "tool_result",
      runId,
      callId: "call-3",
      result: "✓ lint passed",
      success: true,
    },
    {
      type: "run_completed",
      runId,
      result: {
        runId,
        status: "completed",
        artifacts: { filesModified: ["features/ticket/model.ts"] },
        summary: "重构完成，修改了 1 个文件，lint 通过",
        durationMs: 5000,
      },
    },
  ];

  let index = 0;
  const delay = 200; // 每个事件间隔 200ms

  async function* generator(): AsyncGenerator<SubAgentEvent> {
    for (const event of events) {
      if (index > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      index++;
      yield event;
    }
  }

  return generator();
}

/**
 * Pi 原生事件 → SubAgentEvent 单事件翻译
 *
 * Phase 3: 接入真实 Pi SDK 时使用
 * Phase 5: 完整事件映射，支持所有 Pi SDK 事件类型
 * 
 * 映射规则：
 * 1. agent_message / assistant_message → assistant_message
 * 2. tool_call / tool_invocation → tool_call
 * 3. tool_result / tool_execution_end → tool_result
 * 4. tool_execution_error / tool_error → tool_error
 * 5. error / session_error → error
 * 6. session_started / run_started → run_started
 * 7. session_completed / run_completed → run_completed
 * 8. progress / step_progress → progress
 * 9. approval_required / hil_approval → approval_required
 */
export function translateSingleEvent(piEvent: PiEvent, runId: string): SubAgentEvent | null {
  switch (piEvent.type) {
    // ─── 消息事件 ────────────────────────────────────
    case "agent_message":
    case "assistant_message":
    case "message": // Pi SDK 简单消息事件
      return {
        type: "assistant_message",
        runId,
        content: (piEvent.content as string) ?? "",
        delta: piEvent.delta as string | undefined,
      };
    
    // ─── Pi SDK 流式消息更新事件（text_delta）────────
    case "message_update": {
      const event = piEvent as any;
      if (event.assistantMessageEvent?.type === "text_delta") {
        return {
          type: "assistant_message",
          runId,
          content: event.assistantMessageEvent.delta ?? "",
          delta: event.assistantMessageEvent.delta,
        };
      }
      // 其他类型的 message_update（如 text_end）忽略
      return null;
    }

    // ─── 工具调用事件 ────────────────────────────────
    case "tool_call":
    case "tool_invocation":
      return {
        type: "tool_call",
        runId,
        eventId: (piEvent.eventId as string) ?? `evt_${Date.now()}`,
        tool: (piEvent.tool as string) ?? (piEvent as any).toolName ?? "",
        args: (piEvent.args as Record<string, unknown>) ?? (piEvent as any).parameters ?? {},
        callId: (piEvent.callId as string) ?? (piEvent as any).id ?? "",
      };

    // ─── 工具结果事件 ────────────────────────────────
    case "tool_result":
    case "tool_execution_end":
    case "tool_response":
      return {
        type: "tool_result",
        runId,
        callId: (piEvent.callId as string) ?? (piEvent as any).id ?? "",
        result: piEvent.result ?? (piEvent as any).output ?? null,
        success: (piEvent.success as boolean) ?? !(piEvent as any).error,
      };

    // ─── 工具错误事件 ────────────────────────────────
    case "tool_execution_error":
    case "tool_error":
      return {
        type: "tool_error",
        runId,
        callId: (piEvent.callId as string) ?? "",
        error: (piEvent.message as string) ?? (piEvent as any).error ?? "Tool execution failed",
      };

    // ─── 通用错误事件 ────────────────────────────────
    case "error":
    case "session_error":
    case "fatal_error":
      return {
        type: "error",
        runId,
        message: (piEvent.message as string) ?? (piEvent as any).error ?? "Unknown error",
      };

    // ─── Session 启动事件 ────────────────────────────
    case "run_started":
    case "session_started":
    case "agent_started":
      return {
        type: "run_started",
        runId,
        sessionId: (piEvent.sessionId as string) ?? (piEvent.runId as string) ?? (piEvent as any).id ?? "",
      };

    // ─── Session 完成事件 ────────────────────────────
    case "run_completed":
    case "session_completed":
    case "agent_completed":
      return {
        type: "run_completed",
        runId,
        result: piEvent.result as SubAgentEvent extends { type: "run_completed"; result: infer R } ? R : never,
      };

    // ─── HIL 审批事件 ─────────────────────────────────
    case "approval_required":
    case "hil_approval":
    case "human_approval_required":
      return {
        type: "approval_required",
        runId,
        callId: (piEvent.callId as string) ?? (piEvent as any).id ?? "",
        tool: (piEvent.tool as string) ?? (piEvent as any).toolName ?? "",
        args: piEvent.args ?? (piEvent as any).parameters ?? {},
        reason: (piEvent.reason as string) ?? (piEvent as any).message ?? "Approval required",
      };

    // ─── 进度事件 ────────────────────────────────────
    case "progress":
    case "step_progress":
    case "execution_progress":
      return {
        type: "progress",
        runId,
        message: (piEvent.message as string) ?? (piEvent as any).status ?? "",
        percent: (piEvent.percent as number) ?? (piEvent as any).progress ?? 0,
      };

    // ─── 忽略的事件类型 ──────────────────────────────
    case "heartbeat":
    case "ping":
    case "system_info":
      // 心跳和系统信息事件不需要转发到 SubAgent 层
      return null;

    default:
      // 未知事件类型，记录日志但不抛错
      console.warn(`[translateSingleEvent] Unknown Pi event type: ${(piEvent as any).type}`, piEvent);
      return null;
  }
}
