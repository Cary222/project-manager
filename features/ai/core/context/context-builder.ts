/**
 * Context Builder — assembles ChatContext for the LangGraph pipeline.
 *
 * Pulls together all ambient context for a single request:
 *   - RuntimeState (HIL + semantic, from DB)
 *   - PendingState (HIL bridge: DB primary, Map fallback)
 *   - ConversationHistory (from DB or client)
 *   - UserProfile (for personalization)
 *   - clientCity (from request)
 *
 * Usage:
 *   const ctx = await buildChatContext({ conversationId, message, session, conversationHistory });
 *   // ctx.runtimeState  → used by route.ts initialState
 *   // ctx.pendingState   → legacy HIL bridge (DB + Map fallback)
 *   // ctx.conversationHistory → passed to buildMessages()
 */

import { loadRuntimeState, clearPendingHumanAction } from "./conversation-state-store";
import { getPendingHumanAction } from "./runtime-state-bridge";
import { getUserProfileAction } from "@/features/profile/lib/profile-actions";
import type { PendingHumanActionState } from "./runtime-state-bridge";

export interface ChatContext {
  /** HIL + semantic runtime state from DB (raw shape) */
  runtimeState: ConversationRuntimeState;
  /** Legacy HIL bridge state — DB primary, Map fallback */
  pendingState: PendingHumanActionState | undefined;
  /** Conversation message history */
  conversationHistory: Array<{ id: string; role: string; content: string; metadata?: unknown }>;
  /** User profile for personalization */
  userProfile: Record<string, unknown> | null;
  /** Client city for weather / real-time data */
  clientCity: string | null;
  /** Extra metadata about the context */
  metadata?: { messageCount: number };
}

export interface ConversationRuntimeState {
  human?: {
    pendingAction: unknown;
    originalQuery: string;
    resolvedEntities: unknown;
    waitingNode: string | null;
    lastAssistantMessage: string;
    mode: string;
  };
  semantic?: {
    lastMentionedUser: { id: string; name: string; mentionedAt: string } | null;
    recentMentions: Array<{ id: string; name: string; mentionedAt: string }>;
    topicTags: string[];
  };
}

export interface ChatContextInput {
  conversationId: string;
  message: string;
  session: { user: { id: string; name?: string | null; email?: string | null } };
  conversationHistory: Array<{ id: string; role: string; content: string; metadata?: unknown }>;
  modelName?: string;
  clientCity?: string | null;
  /** Enable dev-mode console logging (default false in production) */
  devLog?: boolean;
}

/**
 * Build a complete ChatContext for a single request.
 */
export async function buildChatContext(input: ChatContextInput): Promise<ChatContext> {
  const { conversationId, session, conversationHistory, devLog = false } = input;

  // Load RuntimeState from DB (with 5s in-memory cache)
  const runtimeState =
    (await loadRuntimeState(conversationId)) ??
    ({ human: undefined, semantic: undefined } as ConversationRuntimeState);

  // ── Stale-pending guard ──────────────────────────────────────────────────
  // If a previous request left a dangling pendingAction (e.g. from an abandoned
  // SSE session or a completed HIL round that didn't clear the DB state), clear
  // it now so it does NOT hijack the new message's intent-detection round.
  //
  // IMPORTANT: We must NOT clear pendingAction when it's part of an ACTIVE HIL
  // flow (user just saw candidates and is about to reply). The signal for "stale"
  // is: pendingAction exists BUT resolvedEntities is also set (meaning the user
  // already confirmed in a previous message, so pendingAction should have been
  // cleared but wasn't).
  //
  // Previously, this guard only checked `pendingAction != null` and always cleared,
  // which broke valid HIL flows where the user receives candidates in message N
  // and replies with a selection in message N+1. The fix: only clear when
  // resolvedEntities is present (confirmation complete) or when waitingNode is null
  // AND pendingAction exists (stale from an abandoned flow).
  const hasPendingAction =
    runtimeState.human?.pendingAction != null &&
    typeof runtimeState.human.pendingAction === "object" &&
    (runtimeState.human.pendingAction as { type?: string }).type != null;
  const hasResolvedEntity =
    runtimeState.human?.resolvedEntities != null &&
    typeof runtimeState.human.resolvedEntities === "object";
  const hasStalePending = hasPendingAction && hasResolvedEntity;

  if (hasStalePending) {
    if (devLog) {
      console.log(
        `[AI-LangGraph] clearing stale pendingAction (type=${(runtimeState.human?.pendingAction as { type?: string })?.type ?? "unknown"}) because resolvedEntities is set`
      );
    }
    await clearPendingHumanAction(conversationId);
    // Re-load so the cleared state is what we return downstream
    runtimeState.human = {
      pendingAction: null,
      originalQuery: "",
      resolvedEntities: null,
      waitingNode: null,
      lastAssistantMessage: runtimeState.human?.lastAssistantMessage ?? "",
      mode: runtimeState.human?.mode ?? "chat",
    };
  }

  // Load legacy HIL bridge state (DB RuntimeState primary, Map fallback)
  const pendingState = await getPendingHumanAction(conversationId);

  if (devLog) {
    const candidateCount =
      pendingState?.pendingHumanAction &&
      typeof pendingState.pendingHumanAction === "object" &&
      "candidates" in pendingState.pendingHumanAction
        ? ((pendingState.pendingHumanAction as { candidates?: unknown[] }).candidates?.length ?? 0)
        : 0;
    console.log(
      `[AI-LangGraph] pendingState loaded: entityType=${(pendingState?.pendingHumanAction as { entityType?: string })?.entityType ?? "n/a"} candidates=${candidateCount}`,
    );
    console.log(
      `[AI-LangGraph] runtimeState loaded: human=${runtimeState.human ? "yes" : "no"} semantic.lastMentionedUser=${runtimeState.semantic?.lastMentionedUser?.name ?? "null"}`,
    );
  }

  // Load user profile for personalization
  let userProfile: Record<string, unknown> | null = null;
  try {
    const profileData = await getUserProfileAction(session.user.id);
    userProfile = profileData as unknown as Record<string, unknown>;
    if (devLog) {
      console.log(
        `[AI-LangGraph] userProfile loaded: id=${(profileData as { id?: string }).id} name=${(profileData as { name?: string }).name}`,
      );
    }
  } catch (err) {
    if (devLog) {
      console.warn(
        `[AI-LangGraph] failed to load userProfile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    runtimeState,
    pendingState,
    conversationHistory,
    userProfile,
    clientCity: input.clientCity ?? null,
    metadata: { messageCount: conversationHistory.length },
  };
}
