/**
 * Runtime State Adapter — unified parser for LangGraph node outputs.
 *
 * Converts raw node output fields (pendingHumanAction, lastAssistantMessage,
 * lastMentionedUser, resolvedEntities, etc.) into structured RuntimeState patches.
 *
 * This is the single point of parsing logic for all graph nodes.
 * When Workflow Agent changes output format, only this file needs updating.
 */

import type { ConversationRuntimeState } from "./conversation-state-store";

/** Patch shape produced by parseNodeOutput */
export interface ParsedRuntimePatch {
  human?: Partial<ConversationRuntimeState["human"]>;
  semantic?: Partial<ConversationRuntimeState["semantic"]>;
}

/**
 * Raw node output from graph.stream() updates.
 * Fields match LangGraph StateSchema keys.
 */
export interface NodeOutput {
  pendingHumanAction?: unknown;
  lastAssistantMessage?: string;
  originalQuery?: string;
  resolvedEntities?: unknown;
  waitingNode?: string;
  mode?: string;
  lastMentionedUser?: { id: string; name: string; mentionedAt?: string } | null;
  recentMentions?: Array<{ id: string; name: string; mentionedAt?: string }>;
  topicTags?: string[];
  response?: string;
  toolResults?: unknown;
}

/**
 * Parse a LangGraph node output into a RuntimeState patch.
 *
 * Returns both human and semantic patches.
 * Empty patches (no fields present) are returned as empty objects — callers
 * should check `patch.human || patch.semantic` before applying.
 *
 * lastMentionedUser = null is intentionally included in the patch
 * (used to clear the field, not skip it).
 */
export function parseNodeOutput(output: NodeOutput): ParsedRuntimePatch {
  const patch: ParsedRuntimePatch = {};

  // ── Human state ──────────────────────────────────────────────────────────────
  const hasHuman =
    output.pendingHumanAction !== undefined ||
    output.lastAssistantMessage !== undefined ||
    output.originalQuery !== undefined ||
    output.resolvedEntities !== undefined ||
    output.waitingNode !== undefined ||
    output.mode !== undefined;

  if (hasHuman) {
    patch.human = {};
    if (output.pendingHumanAction !== undefined) {
      patch.human.pendingAction = output.pendingHumanAction;
    }
    if (output.lastAssistantMessage !== undefined) {
      patch.human.lastAssistantMessage = output.lastAssistantMessage;
    }
    if (output.originalQuery !== undefined) {
      patch.human.originalQuery = output.originalQuery;
    }
    if (output.resolvedEntities !== undefined) {
      patch.human.resolvedEntities = output.resolvedEntities;
    }
    if (output.waitingNode !== undefined) {
      patch.human.waitingNode = output.waitingNode;
    }
    if (output.mode !== undefined) {
      patch.human.mode = output.mode;
    }
  }

  // ── Semantic context ────────────────────────────────────────────────────────
  // Explicitly check undefined — null is a valid value (means "clear this field")
  const hasSemantic =
    output.lastMentionedUser !== undefined ||
    output.recentMentions !== undefined ||
    output.topicTags !== undefined;

  if (hasSemantic) {
    patch.semantic = {};
    if (output.lastMentionedUser !== undefined) {
      patch.semantic.lastMentionedUser = output.lastMentionedUser
        ? {
            id: output.lastMentionedUser.id,
            name: output.lastMentionedUser.name,
            mentionedAt: output.lastMentionedUser.mentionedAt ?? new Date().toISOString(),
          }
        : null;
    }
    if (output.recentMentions !== undefined) {
      patch.semantic.recentMentions = output.recentMentions.map((m) => ({
        id: m.id,
        name: m.name,
        mentionedAt: m.mentionedAt ?? new Date().toISOString(),
      }));
    }
    if (output.topicTags !== undefined) {
      patch.semantic.topicTags = [...output.topicTags];
    }
  }

  return patch;
}
