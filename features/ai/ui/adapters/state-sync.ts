/**
 * UI 状态同步管理
 *
 * 基于 Zustand 管理 ChatWorkspace 的运行时状态：
 * - 消息列表
 * - 流式状态
 * - 当前 runId
 * - thinking 状态
 */

import { create } from "zustand";
import type { AgentMessage, AssistantMessage, UserMessage, SimpleMessage, AssistantContentBlock } from "../ai-workspace/types";
import type { WorkEvent } from "./work-event-adapter";
import { toAgentMessage } from "../ai-workspace/types";

/**
 * Chat 运行时状态
 */
export interface ChatState {
  messages: (UserMessage | AssistantMessage)[];
  isStreaming: boolean;
  isThinking: boolean;
  currentRunId: string | null;
  error: string | null;

  addMessage: (message: SimpleMessage) => void;
  updateLastMessage: (content: string) => void;
  appendToLastMessage: (delta: string) => void;
  setStreaming: (streaming: boolean) => void;
  setThinking: (thinking: boolean) => void;
  setRunId: (runId: string | null) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

/**
 * Chat 状态管理 Store
 */
export const useChatState = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  isThinking: false,
  currentRunId: null,
  error: null,

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, toAgentMessage(message)],
    })),

  updateLastMessage: (content) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      return {
        messages: state.messages.map((msg, idx) =>
          idx === state.messages.length - 1 && msg.role === "assistant"
            ? { ...msg, content: [{ type: "text", text: content }] }
            : msg
        ),
      };
    }),

  appendToLastMessage: (delta) =>
    set((state) => {
      if (state.messages.length === 0) return state;
      const lastIdx = state.messages.length - 1;
      const lastMsg = state.messages[lastIdx];
      if (lastMsg.role !== "assistant") return state;
      const assistantMsg = lastMsg as AssistantMessage;
      const currentContent = assistantMsg.content;
      const prevText = Array.isArray(currentContent) 
        ? currentContent.find((b) => b.type === "text")?.text ?? ""
        : "";
      const newContent = prevText + delta;
      return {
        messages: state.messages.map((msg, idx) =>
          idx === lastIdx && msg.role === "assistant"
            ? { ...msg, content: [{ type: "text" as const, text: newContent }] }
            : msg
        ),
      };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setThinking: (thinking) => set({ isThinking: thinking }),
  setRunId: (runId) => set({ currentRunId: runId }),
  setError: (error) => set({ error }),
  clear: () =>
    set({
      messages: [],
      isStreaming: false,
      isThinking: false,
      currentRunId: null,
      error: null,
    }),
}));

/**
 * 将 WorkEvent 应用到 ChatState
 *
 * @param event - WorkEvent 事件
 * @param chatState - ChatState store 实例（用于调用 actions）
 */
export function applyWorkEventToState(
  event: WorkEvent,
  chatState: Pick<ChatState, "addMessage" | "updateLastMessage" | "appendToLastMessage" | "setStreaming" | "setThinking" | "setRunId" | "setError">
): void {
  const { type, payload } = event;
  const p = payload as Record<string, unknown>;

  switch (type) {
    case "pi_run_started":
      chatState.setRunId((p.runId as string) ?? null);
      chatState.setThinking(true);
      chatState.setError(null);
      break;

    case "pi_session_started":
      // Pi session 已启动，等待 assistant_message
      chatState.setThinking(true);
      break;

    case "dispatch_result":
      // 路由决策阶段，设置 thinking
      chatState.setThinking(true);
      break;

    case "workflow_progress":
      // workflow 执行中
      chatState.setThinking(true);
      break;

    case "pi_assistant_message": {
      const content = (p.content as string) ?? "";
      const delta = p.delta as string | undefined;

      if (delta) {
        // 流式增量更新
        chatState.appendToLastMessage(delta);
      } else if (content) {
        // 完整消息，添加到列表
        chatState.addMessage({
          role: "assistant",
          content,
          timestamp: event.timestamp,
        } as SimpleMessage);
      }
      break;
    }

    case "pi_tool_call":
      chatState.setThinking(false);
      break;

    case "pi_tool_result":
      // TODO: 合并到 tool message
      chatState.setThinking(true);
      break;

    case "pi_tool_error":
      chatState.setThinking(false);
      chatState.setError(`工具执行失败: ${p.error}`);
      break;

    case "pi_progress":
      chatState.setThinking(true);
      break;

    case "pi_error":
      chatState.setThinking(false);
      chatState.setStreaming(false);
      chatState.setError((p.message as string) ?? "未知错误");
      break;

    case "pi_run_completed":
      chatState.setThinking(false);
      chatState.setStreaming(false);
      chatState.setRunId(null);
      break;

    case "pi_ignore":
      // 忽略，不做处理
      break;

    default:
      break;
  }
}
