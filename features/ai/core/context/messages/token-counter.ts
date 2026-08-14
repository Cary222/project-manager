/**
 * Token Counter — thin wrapper around gpt-tokenizer.
 *
 * Used by history-window to estimate token cost per message
 * so we can truncate history to fit within the context budget.
 */

import { countTokens as gptCountTokens } from "gpt-tokenizer";

/**
 * Count tokens in a plain text string.
 */
export function countTokens(text: string): number {
  return gptCountTokens(text);
}

/**
 * Count tokens for an array of messages.
 * Adds a ~4 token overhead per message (role + role-name overhead estimate).
 */
export function countMessageTokens(
  msgs: Array<{ content: string }>,
): number {
  return msgs.reduce((sum, m) => sum + countTokens(m.content) + 4, 0);
}
