/**
 * Messages Builder — pure data transformation: raw history → LangChain BaseMessage[].
 *
 * Responsibilities:
 *   1. Token-budgeted history truncation (via history-window)
 *   2. Deduplication by message `id` (not content) — re-sent messages preserved
 *   3. Metadata rehydration into AIMessage.response_metadata (not additional_kwargs)
 *   4. Pending lastAssistantMessage insertion
 *   5. Append current input as multimodal HumanMessage (text + image_url parts)
 *
 * Multimodal support (#10208 Chat 识图):
 *   - `currentInput.text` 用户的文字输入
 *   - `currentInput.imageUrls` 本轮的图片 URL（已通过 ownership 校验 + resolvedProviderImageSource）
 *   - `historyImageUrls` Map<messageId, imageUrls[]> 历史轮次的图片 URL（按 batch resolve 避免 N+1）
 *
 * This is a pure function — no side effects, no DB access, no async.
 */

import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { truncateHistoryByToken } from "./history-window";
import { adaptMessageMetadata } from "./message-metadata-adapter";
import { buildMultimodalContent } from "./multimodal-builder";

export interface CurrentInput {
  /** 用户输入的文本 */
  text: string;
  /**
   * 本轮用户上传的图片 URL（data URI 或 https URL）。
   * 已通过 ownership 校验 + resolveProviderImageSource 解析。
   * 会构造成 HumanMessage([text, image_url, ...]) 的 image_url part。
   */
  imageUrls?: string[];
}

export interface MessagesBuilderOptions {
  /** Conversation history from DB or client (must include `id` for deduplication) */
  history: Array<{ id: string; role: string; content: string; metadata?: unknown }>;
  /**
   * 兼容旧调用方：纯文本的当前消息。
   * 与 `currentInput` 二选一；后者优先。
   */
  currentMessage?: string;
  /** 当前输入（多模态）。 */
  currentInput?: CurrentInput;
  /** Token budget for history sliding window (default 4000) */
  historyTokenLimit?: number;
  /** Reserved budget for system + RAG + output (default 2000) */
  systemAndRagTokenLimit?: number;
  /**
   * Assistant message from a previous HIL round — injected before currentMessage
   * when the conversation was interrupted and the client didn't re-send it.
   */
  pendingLastAssistantMessage?: string;
  /**
   * 历史轮次的图片 URL 批量映射：messageId → imageUrls[]。
   * 用于把历史 user message 也构造成多模态 HumanMessage（不丢上下文）。
   * 缺失的 messageId 视为无图（退回 string content）。
   */
  historyImageUrls?: Map<string, string[]>;
}

/**
 * Build the messages array for LangChain from raw history.
 *
 * Processing order:
 *   1. Truncate history by token budget
 *   2. Deduplicate by `id` (preserves re-sent messages)
 *   3. Hydrate AIMessage metadata into response_metadata
 *   4. Reconstruct historical user HumanMessages as multimodal (text + image_url)
 *   5. Inject pendingLastAssistantMessage if needed
 *   6. Append current HumanMessage (multimodal if imageUrls)
 */
export function buildMessages(opts: MessagesBuilderOptions): BaseMessage[] {
  const {
    history,
    currentMessage,
    currentInput,
    historyTokenLimit = 4000,
    systemAndRagTokenLimit = 2000,
    pendingLastAssistantMessage,
    historyImageUrls,
  } = opts;

  // 兼容旧调用方（currentMessage 字符串）
  const effectiveCurrentText = currentInput?.text ?? currentMessage ?? "";
  if (!currentInput && currentMessage === undefined) {
    throw new Error("buildMessages: 必须提供 currentMessage 或 currentInput");
  }

  // Step 1: Truncate by token budget (W1 fix: pass historyImageUrls so
  // picture messages cost extra ~700 tokens each, naturally making over-budget
  // image rounds drop out of the window first).
  const truncated = truncateHistoryByToken(history, {
    historyTokenLimit,
    systemAndRagTokenLimit,
    currentMessage: effectiveCurrentText,
    historyImageUrls,
  });

  // Build id → truncated msg lookup for O(1) check
  const truncatedIds = new Set(truncated.map((m) => m.id));

  const result: BaseMessage[] = [];
  const seen = new Set<string>();

  // Step 2-4: Convert to BaseMessage with id-based deduplication + multimodal history
  for (const msg of history) {
    if (!truncatedIds.has(msg.id)) continue; // Not in truncated window
    if (seen.has(msg.id)) continue;          // Already added (id deduplication)
    seen.add(msg.id);

    if (msg.role === "user") {
      const historicalImageUrls = historyImageUrls?.get(msg.id);
      const content = buildMultimodalContent(msg.content, historicalImageUrls);
      result.push(new HumanMessage({ content }));
    } else {
      const hydrated = adaptMessageMetadata(msg.metadata);
      // Metadata goes into response_metadata, NOT additional_kwargs.
      // `as any` + `as unknown as BaseMessage` 是必须的：LangChain 1.x AIMessage
      // 构造器的类型签名只暴露 lc_namespace/additional_kwargs/content/name/tool_calls，
      // 不直接暴露 response_metadata 字段；TS 编译时不允许把 hydrated 传给未声明的字段。
      // 替代方案是先 new AIMessage(content) 再 instance.response_metadata = hydrated，
      // 但构造函数更早完成 hydration，调试时 stack 更清楚。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.push(new AIMessage({ content: msg.content, response_metadata: hydrated ?? undefined } as any) as unknown as BaseMessage);
    }
  }

  // Step 5: Inject pending lastAssistantMessage if it wasn't in history
  if (pendingLastAssistantMessage) {
    const last = result[result.length - 1];
    const lastIsSameAi =
      last?.getType() === "ai" && (last.content as string) === pendingLastAssistantMessage;
    if (!lastIsSameAi) {
      result.push(new AIMessage(pendingLastAssistantMessage));
    }
  }

  // Step 6: Append current input as multimodal HumanMessage
  const currentContent = buildMultimodalContent(
    effectiveCurrentText,
    currentInput?.imageUrls,
  );
  result.push(new HumanMessage({ content: currentContent }));

  return result;
}
