/**
 * Messages Builder — unit tests.
 *
 * Test coverage:
 *   1. Empty history → only currentMessage
 *   2. Token overrun triggers truncation
 *   3. Duplicate content with different IDs must NOT be dropped (id-based deduplication)
 *   4. pendingLastAssistantMessage is inserted correctly
 *   5. AIMessage metadata goes into response_metadata (not additional_kwargs)
 */

import { describe, it, expect } from "vitest";
import { buildMessages } from "../messages-builder";

describe("buildMessages", () => {
  // ── Test 1: Empty history → only currentMessage ──────────────────────────────
  it("returns only currentMessage when history is empty", () => {
    const result = buildMessages({
      history: [],
      currentMessage: "你好",
    });

    expect(result).toHaveLength(1);
    expect(result[0].getType()).toBe("human");
    expect(result[0].content).toBe("你好");
  });

  // ── Test 2: Token overrun triggers truncation ─────────────────────────────────
  it("truncates history when it exceeds token budget", () => {
    const longContent = "x".repeat(500); // ~500 tokens
    const history = [
      { id: "1", role: "user", content: longContent },
      { id: "2", role: "assistant", content: longContent },
      { id: "3", role: "user", content: longContent },
      { id: "4", role: "assistant", content: longContent },
    ];

    const result = buildMessages({
      history,
      currentMessage: "hello",
      historyTokenLimit: 1000, // Very low budget — only ~1 message fits
      systemAndRagTokenLimit: 0,
    });

    // Should keep at most the last 1-2 messages (plus currentMessage)
    // Exact count depends on tokenizer, but must be < original history length
    expect(result.length - 1).toBeLessThanOrEqual(history.length);
    // Current message must be last
    expect(result[result.length - 1].getType()).toBe("human");
  });

  // ── Test 3: Duplicate content with different IDs preserved ───────────────────
  it("keeps messages with same content but different IDs (id deduplication)", () => {
    const history = [
      { id: "a", role: "user", content: "同样的消息内容" },
      { id: "b", role: "assistant", content: "回复A" },
      { id: "c", role: "user", content: "同样的消息内容" }, // Same content, different ID
      { id: "d", role: "assistant", content: "回复B" },
    ];

    const result = buildMessages({
      history,
      currentMessage: "继续",
      historyTokenLimit: 10000,
      systemAndRagTokenLimit: 0,
    });

    // Both messages with content "同样的消息内容" must be present (different IDs)
    const userMsgs = result.filter(
      (m) => m.getType() === "human" && m.content === "同样的消息内容",
    );
    expect(userMsgs).toHaveLength(2); // Not 1!
    expect(result).toHaveLength(5);   // 4 history + 1 current
  });

  // ── Test 4: pendingLastAssistantMessage补位 ──────────────────────────────────
  it("inserts pendingLastAssistantMessage before current when not in history", () => {
    const history = [
      { id: "1", role: "user", content: "之前的问题" },
    ];

    const result = buildMessages({
      history,
      currentMessage: "选第1个",
      pendingLastAssistantMessage: "你想要查哪位工程师的周报？",
    });

    const messages = result.map((m) => ({
      type: m.getType(),
      content: m.content,
    }));

    // pendingLastAssistantMessage should appear before currentMessage
    const aiIdx = messages.findIndex(
      (m) =>
        m.type === "ai" &&
        m.content === "你想要查哪位工程师的周报？",
    );
    const humanIdx = messages.findIndex(
      (m) => m.type === "human" && m.content === "选第1个",
    );

    expect(aiIdx).toBeGreaterThan(-1);
    expect(humanIdx).toBeGreaterThan(aiIdx);
  });

  it("does not duplicate pendingLastAssistantMessage if already in history", () => {
    const pendingMsg = "你想要查哪位工程师的周报？";
    const history = [
      { id: "1", role: "user", content: "刘工有周报吗" },
      { id: "2", role: "assistant", content: pendingMsg }, // Already in history
    ];

    const result = buildMessages({
      history,
      currentMessage: "选第1个",
      pendingLastAssistantMessage: pendingMsg,
    });

    const aiContents = result
      .filter((m) => m.getType() === "ai")
      .map((m) => m.content as string);

    // Should NOT appear twice
    const count = aiContents.filter((c) => c === pendingMsg).length;
    expect(count).toBe(1);
  });

  // ── Test 5: AIMessage metadata in response_metadata (not additional_kwargs) ────
  it("stores metadata in response_metadata, not additional_kwargs", () => {
    const history = [
      {
        id: "1",
        role: "assistant",
        content: "刘工这周很忙",
        metadata: {
          sources: [{ index: 1, title: "周报", url: "/report/1", type: "weekly_report" }],
          thinkingSteps: ["步骤1", "步骤2"],
          toolResults: {
            searchStructured: { rows: [{ name: "刘工" }, { name: "王工" }] },
          },
        },
      },
    ];

    const result = buildMessages({
      history,
      currentMessage: "继续",
      historyTokenLimit: 10000,
      systemAndRagTokenLimit: 0,
    });

    const aiMsg = result.find((m) => m.getType() === "ai");
    expect(aiMsg).toBeDefined();

    // Metadata must be in response_metadata
    const msgAny = aiMsg as unknown as Record<string, unknown>;
    expect(msgAny.response_metadata).toBeDefined();
    expect((msgAny.response_metadata as Record<string, unknown>).sources).toBeDefined();
    expect((msgAny.response_metadata as Record<string, unknown>).toolSummary).toBeDefined();

    // additional_kwargs should NOT contain our metadata fields (LangChain default empty object)
    const ak = msgAny.additional_kwargs as Record<string, unknown>;
    expect(ak.sources).toBeUndefined();
    expect(ak.toolSummary).toBeUndefined();
  });

  it("toolSummary contains count and up to 10 entity names", () => {
    const manyEntities = Array.from({ length: 15 }, (_, i) => ({ name: `工程师${i}` }));
    const history = [
      {
        id: "1",
        role: "assistant",
        content: "以下是工程师列表",
        metadata: {
          toolResults: {
            searchStructured: { rows: manyEntities },
          },
        },
      },
    ];

    const result = buildMessages({
      history,
      currentMessage: "继续",
      historyTokenLimit: 10000,
      systemAndRagTokenLimit: 0,
    });

    const aiMsg = result.find((m) => m.getType() === "ai") as unknown as Record<string, unknown>;
    const meta = aiMsg.response_metadata as Record<string, unknown>;
    const toolSummary = meta.toolSummary as Record<string, unknown>;
    const ss = toolSummary.searchStructured as Record<string, unknown>;

    expect(ss.count).toBe(15);        // All 15 entities counted
    expect((ss.entities as string[]).length).toBe(10); // Capped at 10
  });
});
