import type { AgentMessage, AssistantContentBlock, AssistantMessage, ToolResultMessage } from "./types";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "./git-types";
import { extractTurnWrittenFiles, type WrittenFile } from "./turn-written-files";

/**
 * Conversation-scoped file-change tracking.
 *
 * Unlike the workspace-wide git view (which mixes every conversation's edits),
 * this layer attributes changed files to the conversation that wrote them.
 * The source of truth is the message stream itself: every successful
 * write/edit tool call in an assistant turn is replayed into a per-session
 * path list. Replaying from messages makes the list:
 *   - correct after refresh/restart (messages persist server-side)
 *   - isolated between parallel conversations (each session has its own list)
 *   - conservative (only tool calls with a successful result count)
 */

const STORAGE_KEY_PREFIX = "pm:conversation-changes:";

export interface StoredConversationChanges {
  /** Repo-relative or absolute paths written by this conversation. */
  paths: string[];
  updatedAt: number;
}

/** localStorage-backed per-session path list. Survives refresh/restart. */
export function saveConversationPaths(
  sessionId: string,
  paths: string[],
): void {
  if (typeof localStorage === "undefined") return;
  const payload: StoredConversationChanges = { paths, updatedAt: Date.now() };
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + sessionId,
      JSON.stringify(payload),
    );
  } catch {
    // Quota/unavailable storage: degrade silently — replay still works in-memory.
  }
  notifyConversationChanges();
}

/** Listeners fired whenever any session's written-path list changes. */
type ChangesListener = () => void;
const changesListeners = new Set<ChangesListener>();

export function subscribeConversationChanges(
  listener: ChangesListener,
): () => void {
  changesListeners.add(listener);
  return () => {
    changesListeners.delete(listener);
  };
}

// ponytail: one global notification channel — the panel re-reads its own
// session key; per-session filtering here is not worth the extra plumbing.
function notifyConversationChanges(): void {
  for (const listener of changesListeners) listener();
}

export function loadConversationPaths(sessionId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + sessionId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredConversationChanges;
    return Array.isArray(parsed.paths) ? parsed.paths : [];
  } catch {
    return [];
  }
}

/**
 * Replay every assistant turn of a conversation and collect the distinct
 * files it wrote, in first-seen order. Pure and deterministic — the same
 * message stream always yields the same list.
 */
export function extractConversationWrittenFiles(
  messages: AgentMessage[],
  cwd?: string,
): WrittenFile[] {
  const result: WrittenFile[] = [];
  const seen = new Set<string>();

  // A turn = a user message followed by assistant/toolResult messages. The
  // tool calls we care about live in assistant messages; their results are
  // toolResult messages anywhere in the stream.
  const toolResults = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      toolResults.set(
        (msg as ToolResultMessage).toolCallId,
        msg as ToolResultMessage,
      );
    }
  }

  let turnContent: AssistantContentBlock[] = [];
  const flush = () => {
    if (turnContent.length === 0) return;
    const files = extractTurnWrittenFiles(turnContent, toolResults, cwd);
    for (const f of files) {
      if (seen.has(f.filePath)) continue;
      seen.add(f.filePath);
      result.push(f);
    }
    turnContent = [];
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flush();
    } else if (msg.role === "assistant") {
      turnContent.push(...((msg as AssistantMessage).content ?? []));
    }
  }
  flush();

  return result;
}

export type { WrittenFile };

/** One rendered row of the conversation changes panel. */
export interface ConversationChangeRow {
  /** Absolute touched path (first-seen order preserved). */
  filePath: string;
  /** Repo-relative path used for display and diff requests. */
  displayPath: string;
  /** Live git status kind; "clean" means git no longer reports a change. */
  status: GitFileStatusKind | "clean";
  /** Single-letter badge code (M/A/D/R/U/C), empty when clean. */
  code: string;
}

/**
 * Merge the conversation's touched paths with the live workspace git status.
 * Paths this conversation wrote but git no longer reports as changed surface
 * as "clean" — committed, reverted, or matched by a branch switch. Pure so
 * isolation/status behavior is directly unit-testable.
 */
export function buildConversationChangeRows(
  touchedPaths: string[],
  git: Pick<GitStatusResponse, "repositoryRoot" | "files"> | null,
): ConversationChangeRow[] {
  const root = git?.repositoryRoot ?? null;
  const statusByPath = new Map<string, GitFileStatus>();
  if (git) {
    for (const f of git.files) {
      statusByPath.set(f.filePath, f);
    }
  }

  const seen = new Set<string>();
  const rows: ConversationChangeRow[] = [];
  for (const absPath of touchedPaths) {
    if (!absPath || seen.has(absPath)) continue;
    seen.add(absPath);
    const displayPath =
      root && absPath.startsWith(root + "/")
        ? absPath.slice(root.length + 1)
        : absPath;
    const match = statusByPath.get(displayPath) ?? statusByPath.get(absPath);
    rows.push(
      match
        ? {
            filePath: absPath,
            displayPath: match.filePath,
            status: match.status,
            code: match.code,
          }
        : { filePath: absPath, displayPath, status: "clean", code: "" },
    );
  }
  return rows;
}
