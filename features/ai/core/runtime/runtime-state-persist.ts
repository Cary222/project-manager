/**
 * Runtime State Persister — debounced, batching write-through to DB.
 *
 * Factory that creates a patcher for a single conversation.
 *   patch(patch)  → accumulate + debounce 1s
 *   flush()       → write immediately (used in SSE finally block)
 *   parse(output) → delegates to runtime-state-adapter
 *
 * Architecture:
 *   graph.stream() chunk → patcher.parse(output) → patcher.patch(patch)
 *                                                → debounce 1s → saveRuntimeState()
 *   SSE finally          → patcher.flush() → immediate saveRuntimeState()
 */

import { saveRuntimeState } from "./conversation-state-store";
import { parseNodeOutput } from "./runtime-state-adapter";
import type { ParsedRuntimePatch } from "./runtime-state-adapter";
import type { ConversationRuntimeState } from "./conversation-state-store";

const DEBOUNCE_MS = 1000;

/**
 * Create a RuntimeState patcher bound to a specific conversation.
 */
export function createRuntimeStatePatcher(convId: string) {
  let pending: Partial<ConversationRuntimeState> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(patch: ParsedRuntimePatch) {
    // Merge human and semantic patches into pending state
    if (patch.human) {
      pending.human = { ...(pending.human ?? {}), ...patch.human } as ConversationRuntimeState["human"];
    }
    if (patch.semantic) {
      pending.semantic = { ...(pending.semantic ?? {}), ...patch.semantic } as ConversationRuntimeState["semantic"];
    }

    if (timer) clearTimeout(timer);
    // Debounced write — guarded so a single DB failure does not block future
    // patches and does not leak unhandled rejections into the SSE handler.
    timer = setTimeout(async () => {
      if (Object.keys(pending).length > 0) {
        const snapshot = pending;
        pending = {};
        try {
          await saveRuntimeState(convId, snapshot);
        } catch (err) {
          console.error(
            `[runtime-state-persist] debounced save failed for conv=${convId}:`,
            err,
          );
        }
      }
      timer = null;
    }, DEBOUNCE_MS);
  }

  return {
    /**
     * Accumulate a patch and schedule a debounced flush.
     */
    patch(patch: ParsedRuntimePatch) {
      schedule(patch);
    },

    /**
     * Immediately flush any pending state to DB.
     * Call this in the SSE finally block on stream end/abort/recursion-error.
     *
     * Errors are caught and logged: the caller (SSE finally) must never throw,
     * otherwise the ReadableStream handler will reject the whole stream and
     * surface a 500 to the client instead of a clean stream-end.
     */
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (Object.keys(pending).length > 0) {
        const snapshot = pending;
        pending = {};
        try {
          await saveRuntimeState(convId, snapshot);
        } catch (err) {
          console.error(
            `[runtime-state-persist] flush failed for conv=${convId}:`,
            err,
          );
        }
      }
    },

    /**
     * Parse a node output into a patch (delegates to runtime-state-adapter).
     */
    parse: parseNodeOutput,
  };
}
