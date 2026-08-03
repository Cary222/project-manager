/**
 * Messages Builder — pure data transformation: raw history → LangChain BaseMessage[].
 *
 * Responsibilities:
 *   1. Token-budgeted history truncation (via history-window)
 *   2. Deduplication by message `id` (not content) — re-sent messages preserved
 *   3. Metadata rehydration into AIMessage.response_metadata (not additional_kwargs)
 *   4. Pending lastAssistantMessage insertion
 *   5. Append current message
 *
 * This is a pure function — no side effects, no DB access, no async.
 */

import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { truncateHistoryByToken } from "./history-window";
import { adaptMessageMetadata } from "./message-metadata-adapter";

export interface MessagesBuilderOptions {
  /** Conversation history from DB or client (must include `id` for deduplication) */
  history: Array<{ id: string; role: string; content: string; metadata?: unknown }>;
  /** The current incoming user message */
  currentMessage: string;
  /** Token budget for history sliding window (default 4000) */
  historyTokenLimit?: number;
  /** Reserved budget for system + RAG + output (default 2000) */
  systemAndRagTokenLimit?: number;
  /**
   * Assistant message from a previous HIL round — injected before currentMessage
   * when the conversation was interrupted and the client didn't re-send it.
   */
  pendingLastAssistantMessage?: string;
}

/**
 * Build the messages array for LangChain from raw history.
 *
 * Processing order:
 *   1. Truncate history by token budget
 *   2. Deduplicate by `id` (preserves re-sent messages)
 *   3. Hydrate AIMessage metadata into response_metadata
 *   4. Inject pendingLastAssistantMessage if needed
 *   5. Append current HumanMessage
 */
export function buildMessages(opts: MessagesBuilderOptions): BaseMessage[] {
  const {
    history,
    currentMessage,
    historyTokenLimit = 4000,
    systemAndRagTokenLimit = 2000,
    pendingLastAssistantMessage,
  } = opts;

  // Step 1: Truncate by token budget
  const truncated = truncateHistoryByToken(history, {
    historyTokenLimit,
    systemAndRagTokenLimit,
    currentMessage,
  });

  // Build id → truncated msg lookup for O(1) check
  const truncatedIds = new Set(truncated.map((m) => m.id));

  const result: BaseMessage[] = [];
  const seen = new Set<string>();

  // Step 2-3: Convert to BaseMessage with id-based deduplication
  for (const msg of history) {
    if (!truncatedIds.has(msg.id)) continue; // Not in truncated window
    if (seen.has(msg.id)) continue;          // Already added (id deduplication)
    seen.add(msg.id);

    if (msg.role === "user") {
      result.push(new HumanMessage(msg.content));
    } else {
      const hydrated = adaptMessageMetadata(msg.metadata);
      // Metadata goes into response_metadata, NOT additional_kwargs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.push(new AIMessage({ content: msg.content, response_metadata: hydrated ?? undefined } as any) as unknown as BaseMessage);
    }
  }

  // Step 4: Inject pending lastAssistantMessage if it wasn't in history
  if (pendingLastAssistantMessage) {
    const last = result[result.length - 1];
    const lastIsSameAi =
      last?.getType() === "ai" && (last.content as string) === pendingLastAssistantMessage;
    if (!lastIsSameAi) {
      result.push(new AIMessage(pendingLastAssistantMessage));
    }
  }

  // Step 5: Append current user message
  result.push(new HumanMessage(currentMessage));

  return result;
}
