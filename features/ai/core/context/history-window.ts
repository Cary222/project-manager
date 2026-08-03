/**
 * History Window — token-budgeted sliding window for conversation history.
 *
 * Truncates history from tail to head (newest messages kept) so the most
 * recent context is always available within the token budget.
 *
 * Two independent token limits:
 *   - historyTokenLimit:       sliding window cap for history messages
 *   - systemAndRagTokenLimit:  budget reserved for system prompt + RAG + output
 *
 * Deduplication: uses message `id` to avoid accidentally dropping duplicates
 * (content-based deduplication would silently drop re-sent identical messages).
 */

import { countTokens, countMessageTokens } from "./token-counter";

export interface HistoryWindowOptions {
  /** Sliding window token cap for conversation history */
  historyTokenLimit: number;
  /** Reserved budget for system prompt + RAG + model output */
  systemAndRagTokenLimit: number;
  /** The current incoming message (also charged against history budget) */
  currentMessage: string;
}

/**
 * Truncate conversation history to fit within the token budget.
 * Iterates from newest to oldest, stopping when adding the next message
 * would exceed the available budget.
 *
 * Messages are kept if their total token cost fits.
 * Uses `id` field for deduplication (not content) — re-sent messages with
 * the same content but different IDs are preserved.
 */
export function truncateHistoryByToken(
  messages: Array<{ id: string; role: string; content: string }>,
  opts: HistoryWindowOptions,
): Array<{ id: string; role: string; content: string }> {
  // Available = history budget - reserved - current message
  const available =
    opts.historyTokenLimit -
    opts.systemAndRagTokenLimit -
    countTokens(opts.currentMessage);

  if (available < 0) return [];

  const result: Array<{ id: string; role: string; content: string }> = [];
  let total = 0;
  // Track seen IDs to prevent duplicates from re-sent messages
  const seen = new Set<string>();

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (seen.has(msg.id)) continue; // Skip if already included

    const cost = countMessageTokens([msg]);
    if (total + cost <= available) {
      result.unshift(msg); // Prepend to keep chronological order
      total += cost;
      seen.add(msg.id);
    } else {
      break;
    }
  }

  return result;
}
