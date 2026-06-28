import { prisma } from "@/shared/db/client";
import { summarizeConversation, updateUserProfile } from "./summarizer";

// Use globalThis to survive Next.js dev HMR
const conversationQueue = globalThis as typeof globalThis & {
  __ai_conv_queue?: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; enqueuedAt: number }
  >;
  // Conversation IDs whose summarize just ran (or ran recently). Prevents
  // repeated enqueues when the user clicks the same conversation multiple
  // times in a row, or switches back and forth.
  __ai_conv_recent?: Map<string, number>;
};
const profileQueue = globalThis as typeof globalThis & {
  __ai_profile_queue?: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; enqueuedAt: number }
  >;
};

// How long a conversation is considered "recently summarized" — re-triggering
// summarize before this window expires is a no-op.
const SUMMARIZE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// Debounce window in ms (5s) — declared for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _DEBOUNCE_MS = 5000;

function getConversationQueue() {
  if (!conversationQueue.__ai_conv_queue) {
    conversationQueue.__ai_conv_queue = new Map();
  }
  return conversationQueue.__ai_conv_queue;
}

function getRecentSummarized() {
  if (!conversationQueue.__ai_conv_recent) {
    conversationQueue.__ai_conv_recent = new Map();
  }
  return conversationQueue.__ai_conv_recent;
}

function pruneRecentSummarized(now: number) {
  const recent = getRecentSummarized();
  for (const [id, ts] of recent) {
    if (now - ts > SUMMARIZE_COOLDOWN_MS) recent.delete(id);
  }
}

function wasSummarizedRecently(conversationId: string): boolean {
  const recent = getRecentSummarized();
  const ts = recent.get(conversationId);
  if (ts === undefined) return false;
  if (Date.now() - ts > SUMMARIZE_COOLDOWN_MS) {
    recent.delete(conversationId);
    return false;
  }
  return true;
}

function markSummarized(conversationId: string) {
  pruneRecentSummarized(Date.now());
  getRecentSummarized().set(conversationId, Date.now());
}

function getProfileQueue() {
  if (!profileQueue.__ai_profile_queue) {
    profileQueue.__ai_profile_queue = new Map();
  }
  return profileQueue.__ai_profile_queue;
}

async function doSummarize(conversationId: string, attempt: number = 0) {
  try {
    await summarizeConversation(conversationId);
    // Mark as recently-summarized AFTER success, so failed runs can be
    // retried by other triggers (e.g. switching conversations).
    markSummarized(conversationId);

    // Resolve the real userId from the conversation record — the previous
    // implementation used `conversationId.slice(0, 20)` as a stand-in which
    // matched no real user and silently dropped every profile update.
    const conversation = await prisma.aiConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation) {
      console.warn(
        `[background-jobs] doSummarize: conversation ${conversationId} not found, skipping profile update`
      );
      return;
    }
    await doUpdateProfile(conversation.userId, attempt);
  } catch (err) {
    if (attempt === 0) {
      console.warn(
        `[background-jobs] summarizeConversation retry in 5s:`,
        err
      );
      setTimeout(() => doSummarize(conversationId, 1), 5000);
    } else {
      console.error(
        `[background-jobs] summarizeConversation failed after retry:`,
        err
      );
    }
  }
}

async function doUpdateProfile(userId: string, attempt: number = 0) {
  try {
    await updateUserProfile(userId);
  } catch (err) {
    if (attempt === 0) {
      console.warn(
        `[background-jobs] updateUserProfile retry in 5s:`,
        err
      );
      setTimeout(() => doUpdateProfile(userId, 1), 5000);
    } else {
      console.error(
        `[background-jobs] updateUserProfile failed after retry:`,
        err
      );
    }
  }
}

export function enqueueSummarizeConversation(
  conversationId: string,
  options: { force?: boolean } = {}
): boolean {
  // Cooldown: skip if we just summarized this conversation. The caller can
  // override with `force: true` (e.g. immediately after the user sends a
  // message, where we *do* want a fresh summary).
  if (!options.force && wasSummarizedRecently(conversationId)) {
    return false;
  }

  const queue = getConversationQueue();
  const existing = queue.get(conversationId);

  if (existing) {
    clearTimeout(existing.timer);
    queue.delete(conversationId);
  }

  const timer = setTimeout(() => {
    queue.delete(conversationId);
    doSummarize(conversationId, 0);
  }, 0);

  queue.set(conversationId, { timer, enqueuedAt: Date.now() });
  return true;
}

export function enqueueUpdateProfile(userId: string): void {
  const queue = getProfileQueue();
  const existing = queue.get(userId);

  if (existing) {
    clearTimeout(existing.timer);
    queue.delete(userId);
  }

  const timer = setTimeout(() => {
    queue.delete(userId);
    doUpdateProfile(userId, 0);
  }, 0);

  queue.set(userId, { timer, enqueuedAt: Date.now() });
}
