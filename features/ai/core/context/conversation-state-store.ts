/**
 * Conversation State Store — DB-backed runtime state with 5s in-memory cache.
 *
 * Manages the two-layer runtime state per conversation:
 *   - human: HIL pending action + original query + resolved entities
 *   - semantic: last mentioned user for pronoun resolution
 *
 * Architecture:
 *   loadRuntimeState → Memory (5s TTL) → DB (upsert)
 *   saveRuntimeState → DB (upsert) + Memory invalidate
 *   clearRuntimeState → DB delete + Memory invalidate
 */

import { prisma } from "@/shared/db/client";
import { Prisma } from "@prisma/client";

/** 5-second in-memory cache to avoid DB round-trips on hot paths */
const memoryCache = new Map<string, { data: ConversationRuntimeState; expiresAt: number }>();
const CACHE_TTL_MS = 5000;

/**
 * Runtime state stored per conversation.
 * Mirrors the shape of the DB JSON columns humanState / semanticContext.
 */
export interface ConversationRuntimeState {
  human?: {
    /** HIL pending action (select / approve / confirm / input / upload) */
    pendingAction: unknown;
    /** Original user query before disambiguation */
    originalQuery: string;
    /** Resolved entities from human confirmation */
    resolvedEntities: unknown;
    /** Which node the graph is waiting at */
    waitingNode: string | null;
    /** The assistant message that triggered the HIL pause */
    lastAssistantMessage: string;
    /** Current mode (auto / search / chat / web) */
    mode: string;
  };
  semantic?: {
    /** Last user explicitly mentioned in the conversation (for "他/她" resolution) */
    lastMentionedUser: { id: string; name: string; mentionedAt: string } | null;
    /** Recent mention history (chronological, newest last) */
    recentMentions: Array<{ id: string; name: string; mentionedAt: string }>;
    /** Topic tags derived from conversation context */
    topicTags: string[];
  };
}

/**
 * Lightweight runtime shape guards for JSON columns.
 *
 * Why not Zod: we want zero new runtime dependencies. These guards only check
 * the fields actually used by downstream code — `unknown` is allowed for opaque
 * blobs (pendingAction / resolvedEntities). If a column contains garbage the
 * guard rejects it and we silently drop the field rather than crashing the
 * conversation load path.
 */
function isHumanStateShape(v: unknown): v is NonNullable<ConversationRuntimeState["human"]> {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  if ("lastAssistantMessage" in h && typeof h.lastAssistantMessage !== "string") return false;
  if ("originalQuery" in h && typeof h.originalQuery !== "string") return false;
  if ("mode" in h && typeof h.mode !== "string") return false;
  if ("waitingNode" in h && h.waitingNode !== null && typeof h.waitingNode !== "string") return false;
  // pendingAction / resolvedEntities are intentionally `unknown` — accept anything
  return true;
}

function isMentionShape(v: unknown): v is { id: string; name: string; mentionedAt?: string } {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === "string" && typeof m.name === "string";
}

function isSemanticStateShape(v: unknown): v is NonNullable<ConversationRuntimeState["semantic"]> {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if ("lastMentionedUser" in s && s.lastMentionedUser !== null && !isMentionShape(s.lastMentionedUser)) {
    return false;
  }
  if ("recentMentions" in s) {
    if (!Array.isArray(s.recentMentions)) return false;
    for (const m of s.recentMentions) {
      if (!isMentionShape(m)) return false;
    }
  }
  if ("topicTags" in s && !Array.isArray(s.topicTags)) return false;
  if ("topicTags" in s && Array.isArray(s.topicTags)) {
    for (const tag of s.topicTags) {
      if (typeof tag !== "string") return false;
    }
  }
  return true;
}

/**
 * Load runtime state for a conversation.
 * Checks memory cache first (5s TTL), then falls back to DB.
 *
 * JSON columns are validated with lightweight shape guards — a malformed
 * column (e.g. partial migration or hand-edited row) is silently dropped
 * rather than crashing the conversation.
 */
export async function loadRuntimeState(
  convId: string,
): Promise<ConversationRuntimeState | null> {
  const cached = memoryCache.get(convId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const row = await prisma.aiConversationRuntimeState.findUnique({
    where: { conversationId: convId },
  });

  if (!row) return null;

  const state: ConversationRuntimeState = {};
  if (row.humanState && isHumanStateShape(row.humanState)) {
    state.human = row.humanState;
  }
  if (row.semanticContext && isSemanticStateShape(row.semanticContext)) {
    state.semantic = row.semanticContext;
  }

  memoryCache.set(convId, { data: state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}

/**
 * Save (upsert) runtime state to DB and invalidate cache.
 *
 * Errors are caught, logged, and rethrown so callers (patcher.flush /
 * debounced save) can decide whether to swallow or surface them. The cache is
 * invalidated regardless so the next load hits the DB instead of serving a
 * stale in-memory copy.
 */
export async function saveRuntimeState(
  convId: string,
  state: Partial<ConversationRuntimeState>,
): Promise<void> {
  const updateData: {
    humanState?: Record<string, unknown>;
    semanticContext?: Record<string, unknown>;
  } = {};

  if (state.human !== undefined) {
    updateData.humanState = state.human as Record<string, unknown>;
  }
  if (state.semantic !== undefined) {
    updateData.semanticContext = state.semantic as Record<string, unknown>;
  }

  try {
    await prisma.aiConversationRuntimeState.upsert({
      where: { conversationId: convId },
      create: {
        conversationId: convId,
        ...(updateData.humanState !== undefined
          ? { humanState: updateData.humanState as unknown as Prisma.InputJsonValue }
          : {}),
        ...(updateData.semanticContext !== undefined
          ? { semanticContext: updateData.semanticContext as unknown as Prisma.InputJsonValue }
          : {}),
      } as Prisma.AiConversationRuntimeStateUncheckedCreateInput,
      update: updateData as {
        humanState?: Prisma.InputJsonValue;
        semanticContext?: Prisma.InputJsonValue;
      },
    });
  } catch (err) {
    console.error(`[conversation-state-store] save failed for conv=${convId}:`, err);
    // Invalidate cache anyway so the next load re-reads DB instead of serving
    // a possibly-stale snapshot.
    memoryCache.delete(convId);
    throw err;
  }

  memoryCache.delete(convId);
}

/**
 * Delete runtime state and clear cache.
 */
export async function clearRuntimeState(convId: string): Promise<void> {
  await prisma.aiConversationRuntimeState.deleteMany({ where: { conversationId: convId } });
  memoryCache.delete(convId);
}

/**
 * Clear only the pending human-action part of runtime state.
 *
 * Called when a NEW user message arrives with an existing stale pendingAction
 * from a previous (possibly abandoned) request. This prevents a dangling
 * HIL state from hijacking a fresh intent-detection round.
 *
 * Keeps semanticContext intact so lastMentionedUser survives across rounds.
 */
export async function clearPendingHumanAction(convId: string): Promise<void> {
  memoryCache.delete(convId);
  const clearedHumanState = {
    pendingAction: null,
    originalQuery: "",
    resolvedEntities: null,
    waitingNode: null,
    lastAssistantMessage: "",
    mode: "",
  };
  try {
    await prisma.aiConversationRuntimeState.upsert({
      where: { conversationId: convId },
      create: {
        conversationId: convId,
        humanState: clearedHumanState as unknown as Prisma.InputJsonValue,
        semanticContext: undefined,
      },
      update: {
        humanState: clearedHumanState as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.warn(`[conversation-state-store] clearPendingHumanAction failed for conv=${convId}:`, err);
  }
}
