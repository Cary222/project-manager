/**
 * domain-events.ts — job 内部事件 → message.delta SSE 映射
 * 前端只监听 message.delta，不感知 job 模型。
 */
import type { AiMessageExecutionStatus } from "@prisma/client";

type GlobalSSEEmitter = typeof globalThis & {
  __ai_sse_listeners?: Map<string, Set<(data: string) => void>>;
};

export function registerSSEListener(messageId: string, listener: (data: string) => void): () => void {
  const g = globalThis as GlobalSSEEmitter;
  if (!g.__ai_sse_listeners) g.__ai_sse_listeners = new Map();
  if (!g.__ai_sse_listeners.has(messageId)) g.__ai_sse_listeners.set(messageId, new Set());
  g.__ai_sse_listeners.get(messageId)!.add(listener);
  return () => g.__ai_sse_listeners?.get(messageId)?.delete(listener);
}

export interface MessageDeltaPayload {
  executionStatus?: AiMessageExecutionStatus;
  progress?: { step: string; percent?: number; detail?: string };
  attachments?: Array<{ id: string; type: string; fileAssetId: string }>;
}

export function emitMessageDelta(messageId: string, delta: MessageDeltaPayload): void {
  const g = globalThis as GlobalSSEEmitter;
  const listeners = g.__ai_sse_listeners?.get(messageId);
  if (!listeners || listeners.size === 0) return;

  const payload = JSON.stringify({
    type: "message.delta",
    id: messageId,
    delta,
  });

  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (err) {
      console.error(`[domain-events] SSE listener error for message=${messageId}:`, err);
    }
  }
}
