/**
 * conversation-changes — behavior tests
 *
 * Contract coverage:
 * 1. Per-conversation attribution: replay extracts only files the session
 *    actually wrote (successful write/edit tool calls), in first-seen order.
 * 2. Parallel-conversation isolation: two sessions' message streams yield
 *    disjoint path lists; neither sees the other's files.
 * 3. Persistence/restart recovery: save → new "browser" → load returns the
 *    same list; message replay is idempotent across a simulated restart.
 * 4. Safe degradation: paths git no longer reports surface as "clean"
 *    (resolved externally / branch switch); absolute↔relative mapping works.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "../types";
import {
  buildConversationChangeRows,
  extractConversationWrittenFiles,
  loadConversationPaths,
  saveConversationPaths,
  subscribeConversationChanges,
} from "../conversation-changes";

const CWD = "/repo";

function userMsg(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 0 } as unknown as UserMessage;
}

function assistantWithToolCall(id: string, toolName: string, rawPath: string): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", toolCallId: id, toolName, input: { file_path: rawPath } },
    ],
  } as unknown as AssistantMessage;
}

function assistantText(text: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }] } as unknown as AssistantMessage;
}

function toolResult(id: string, isError = false): ToolResultMessage {
  return { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "ok" }], isError };
}

// ---------------------------------------------------------------------------
// 1. Attribution
// ---------------------------------------------------------------------------

describe("extractConversationWrittenFiles — attribution", () => {
  it("collects files from successful write/edit calls across all turns", () => {
    const messages: AgentMessage[] = [
      userMsg("do it"),
      assistantWithToolCall("c1", "write", `${CWD}/a.ts`),
      toolResult("c1"),
      assistantText("wrote a"),
      userMsg("more"),
      assistantWithToolCall("c2", "edit", `${CWD}/b.ts`),
      toolResult("c2"),
      assistantWithToolCall("c3", "write", `${CWD}/a.ts`), // duplicate, later turn
      toolResult("c3"),
    ];
    const files = extractConversationWrittenFiles(messages, CWD);
    expect(files.map((f) => f.filePath)).toEqual([`${CWD}/a.ts`, `${CWD}/b.ts`]);
  });

  it("ignores failed results and calls without results yet (streaming)", () => {
    const messages: AgentMessage[] = [
      userMsg("go"),
      assistantWithToolCall("bad", "write", `${CWD}/x.ts`),
      toolResult("bad", true),
      assistantWithToolCall("pending", "edit", `${CWD}/y.ts`),
      // no result for "pending" — still streaming
      assistantWithToolCall("ok", "write", `${CWD}/z.ts`),
      toolResult("ok"),
    ];
    const files = extractConversationWrittenFiles(messages, CWD);
    expect(files.map((f) => f.filePath)).toEqual([`${CWD}/z.ts`]);
  });

  it("never attributes files mentioned only in reply prose", () => {
    const messages: AgentMessage[] = [
      userMsg("hi"),
      assistantText(`I updated ${CWD}/mentioned.ts for you`),
    ];
    expect(extractConversationWrittenFiles(messages, CWD)).toEqual([]);
  });

  it("is deterministic — same messages replay to the same list (restart recovery)", () => {
    const messages: AgentMessage[] = [
      userMsg("t1"),
      assistantWithToolCall("c1", "write", `${CWD}/a.ts`),
      toolResult("c1"),
    ];
    const first = extractConversationWrittenFiles(messages, CWD);
    const second = extractConversationWrittenFiles(messages, CWD);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// 2. Parallel-conversation isolation
// ---------------------------------------------------------------------------

describe("extractConversationWrittenFiles — parallel isolation", () => {
  it("keeps two conversations' written sets disjoint", () => {
    const convA: AgentMessage[] = [
      userMsg("A work"),
      assistantWithToolCall("a1", "write", `${CWD}/only-a.ts`),
      toolResult("a1"),
    ];
    const convB: AgentMessage[] = [
      userMsg("B work"),
      assistantWithToolCall("b1", "write", `${CWD}/only-b.ts`),
      toolResult("b1"),
      assistantWithToolCall("b2", "edit", `${CWD}/shared-name.ts`),
      toolResult("b2"),
    ];

    const pathsA = extractConversationWrittenFiles(convA, CWD).map((f) => f.filePath);
    const pathsB = extractConversationWrittenFiles(convB, CWD).map((f) => f.filePath);

    expect(pathsA).toEqual([`${CWD}/only-a.ts`]);
    expect(pathsB).toEqual([`${CWD}/only-b.ts`, `${CWD}/shared-name.ts`]);
    for (const p of pathsA) expect(pathsB).not.toContain(p);
  });

  it("persists per-session lists that do not cross-contaminate", () => {
    saveConversationPaths("session-A", [`${CWD}/a1.ts`]);
    saveConversationPaths("session-B", [`${CWD}/b1.ts`, `${CWD}/b2.ts`]);

    expect(loadConversationPaths("session-A")).toEqual([`${CWD}/a1.ts`]);
    expect(loadConversationPaths("session-B")).toEqual([`${CWD}/b1.ts`, `${CWD}/b2.ts`]);
    expect(loadConversationPaths("session-C")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Persistence / restart recovery
// ---------------------------------------------------------------------------

describe("persistence — localStorage round-trip", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      store: new Map<string, string>() as Map<string, string>,
      setItem(this: { store: Map<string, string> }, k: string, v: string) {
        this.store.set(k, v);
      },
      getItem(this: { store: Map<string, string> }, k: string) {
        return this.store.get(k) ?? null;
      },
      removeItem(this: { store: Map<string, string> }, k: string) {
        this.store.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("survives a simulated restart and fires change notifications", () => {
    const notified = vi.fn();
    const unsubscribe = subscribeConversationChanges(notified);

    saveConversationPaths("s1", [`${CWD}/kept.ts`]);
    expect(notified).toHaveBeenCalled();

    // Simulate restart: fresh read of persisted state.
    const restored = loadConversationPaths("s1");
    expect(restored).toEqual([`${CWD}/kept.ts`]);
    // Replay of the same conversation re-derives the identical list.
    const messages: AgentMessage[] = [
      userMsg("t"),
      assistantWithToolCall("c1", "write", `${CWD}/kept.ts`),
      toolResult("c1"),
    ];
    expect(extractConversationWrittenFiles(messages, CWD).map((f) => f.filePath)).toEqual(restored);

    unsubscribe();
    saveConversationPaths("s1", []);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("degrades safely when storage throws or holds corrupt data", () => {
    vi.stubGlobal("localStorage", {
      setItem() {
        throw new Error("quota");
      },
      getItem: () => "{corrupt json",
    });
    expect(() => saveConversationPaths("s2", ["x"])).not.toThrow();
    expect(loadConversationPaths("s2")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Safe degradation + status merge
// ---------------------------------------------------------------------------

describe("buildConversationChangeRows — merge with live git status", () => {
  const root = "/repo";
  const git = {
    repositoryRoot: root,
    files: [
      { filePath: "mod.ts", status: "modified" as const, code: "M" as const, indexStatus: "M", worktreeStatus: " " },
      { filePath: "new.ts", status: "untracked" as const, code: "U" as const, indexStatus: "?", worktreeStatus: "?" },
      { filePath: "gone.ts", status: "deleted" as const, code: "D" as const, indexStatus: "D", worktreeStatus: " " },
      { filePath: "renamed.ts", status: "renamed" as const, code: "R" as const, indexStatus: "R", worktreeStatus: " " },
    ],
  };

  it("maps absolute touched paths to repo-relative rows with live badges", () => {
    const rows = buildConversationChangeRows(
      [`${root}/mod.ts`, `${root}/new.ts`],
      git,
    );
    expect(rows).toEqual([
      { filePath: `${root}/mod.ts`, displayPath: "mod.ts", status: "modified", code: "M" },
      { filePath: `${root}/new.ts`, displayPath: "new.ts", status: "untracked", code: "U" },
    ]);
  });

  it("covers add / modify / delete / rename kinds end-to-end", () => {
    const rows = buildConversationChangeRows(
      [`${root}/new.ts`, `${root}/mod.ts`, `${root}/gone.ts`, `${root}/renamed.ts`],
      git,
    );
    expect(rows.map((r) => r.status)).toEqual(["untracked", "modified", "deleted", "renamed"]);
    expect(rows.map((r) => r.code)).toEqual(["U", "M", "D", "R"]);
  });

  it("marks externally resolved paths as clean (safe degradation)", () => {
    const rows = buildConversationChangeRows(
      [`${root}/committed-by-user.ts`, `${root}/mod.ts`],
      git,
    );
    expect(rows[0]).toEqual({
      filePath: `${root}/committed-by-user.ts`,
      displayPath: "committed-by-user.ts",
      status: "clean",
      code: "",
    });
  });

  it("degrades safely without git data (non-repo or fetch failure)", () => {
    const rows = buildConversationChangeRows([`${root}/any.ts`], null);
    expect(rows).toEqual([
      { filePath: `${root}/any.ts`, displayPath: `${root}/any.ts`, status: "clean", code: "" },
    ]);
  });

  it("dedupes and preserves first-seen order", () => {
    const rows = buildConversationChangeRows(
      [`${root}/mod.ts`, `${root}/mod.ts`, `${root}/new.ts`],
      git,
    );
    expect(rows.map((r) => r.displayPath)).toEqual(["mod.ts", "new.ts"]);
  });
});
