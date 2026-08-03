/**
 * Runtime State Bridge — converts new RuntimeState (DB) shape to legacy
 * PendingHumanActionState (Map) shape.
 *
 * Why a bridge?
 * The runtime-state-persist layer stores RuntimeState in DB as
 *   { human: { pendingAction, originalQuery, ..., lastAssistantMessage, mode } }
 * but the graph state still reads the legacy shape
 *   { pendingHumanAction, lastAssistantMessage, mode, lastMentionedUser }
 * This bridge normalizes the read path so callers don't have to know about the DB layout.
 *
 * Fallback chain:
 *   1. DB RuntimeState (primary, new)
 *   2. Legacy Map (短期兼容, v4.1 移除)
 *
 * Used by:
 *   - context-builder (buildChatContext)
 *   - route.ts (handleLangGraphRequest pendingState bridge)
 */

import { loadRuntimeState } from "./conversation-state-store";

/** Shape used by LangGraph graph state — mirrors route.ts legacy interface.
 *  Full type definition (preserves sourceResult/entityType/candidates) so route.ts
 *  downstream code can narrow pendingHumanAction via type guards. */
export interface PendingHumanActionState {
  pendingHumanAction: {
    type: "select";
    entity?: string;
    reason?: string;
    entityType: "user" | "ticket" | "project" | "weekly_report";
    candidates: Array<{ id: string; label: string; summary: string }>;
    query: string;
    /** Carries queryType (e.g. "weekly_report") through the HIL pipeline so the next
     *  round's searchStructuredNode knows the original query type, not what the user
     *  typed as a selection ("1"). */
    sourceResult?: { queryType?: string; [key: string]: unknown };
  };
  lastAssistantMessage: string;
  mode: "auto" | "search" | "chat" | "web";
  /** 最近讨论的用户 — 用于"他/她"等代词指代 */
  lastMentionedUser?: { id: string; name: string } | null;
}

/** Legacy in-memory Map fallback (v4.1 移除). */
const pendingHumanActionStore = new Map<string, PendingHumanActionState>();

/**
 * Bridge: RuntimeState (DB) → PendingHumanActionState (legacy shape).
 * Returns undefined when there's no pending action in DB.
 */
export async function bridgeRuntimeToLegacy(
  convId: string,
): Promise<PendingHumanActionState | undefined> {
  const runtime = await loadRuntimeState(convId);
  if (!runtime?.human) return undefined;
  const h = runtime.human;
  return {
    pendingHumanAction: h.pendingAction as PendingHumanActionState["pendingHumanAction"],
    lastAssistantMessage: h.lastAssistantMessage ?? "",
    mode: (h.mode as PendingHumanActionState["mode"]) ?? "auto",
    lastMentionedUser: h.resolvedEntities && typeof h.resolvedEntities === "object"
      ? {
          id: (h.resolvedEntities as Record<string, unknown>).id as string,
          name: (h.resolvedEntities as Record<string, unknown>).name as string,
        }
      : undefined,
  };
}

/**
 * Read pending HIL state with fallback chain:
 *   1. DB RuntimeState (primary)
 *   2. Legacy Map (短期兼容)
 */
export async function getPendingHumanAction(
  conversationId: string,
): Promise<PendingHumanActionState | undefined> {
  const fromDb = await bridgeRuntimeToLegacy(conversationId);
  if (fromDb) return fromDb;
  return pendingHumanActionStore.get(conversationId);
}

/** Write to legacy Map (短期兜底). TODO: remove in v4.1. */
export function setPendingHumanAction(
  conversationId: string,
  state: PendingHumanActionState,
): void {
  pendingHumanActionStore.set(conversationId, state);
}

/** Clear legacy Map entry. TODO: remove in v4.1. */
export function clearPendingHumanAction(conversationId: string): void {
  pendingHumanActionStore.delete(conversationId);
}

/**
 * Legacy Map-based conversation context (lastMentionedUser for pronoun resolution).
 * TODO: remove in v4.1 — replaced by RuntimeState.semantic.
 */
export interface ConversationContext {
  lastMentionedUser?: { id: string; name: string } | null;
}

const conversationContextStore = new Map<string, ConversationContext>();

export function getConversationContext(
  conversationId: string,
): ConversationContext | undefined {
  return conversationContextStore.get(conversationId);
}

export function setConversationContext(
  conversationId: string,
  context: ConversationContext,
): void {
  conversationContextStore.set(conversationId, context);
}
