/**
 * Runtime State Bridge — unit tests.
 *
 * Covers:
 *   1. bridgeRuntimeToLegacy returns undefined when no RuntimeState
 *   2. bridgeRuntimeToLegacy maps human → pendingAction / lastAssistantMessage / mode
 *   3. bridgeRuntimeToLegacy extracts lastMentionedUser from resolvedEntities
 *   4. getPendingHumanAction falls back to legacy Map
 *   5. setPendingHumanAction / clearPendingHumanAction manipulate legacy Map
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  bridgeRuntimeToLegacy,
  getPendingHumanAction,
  setPendingHumanAction,
  clearPendingHumanAction,
  type PendingHumanActionState,
} from "../runtime-state-bridge";
import * as store from "../conversation-state-store";

// Mock the conversation-state-store so we don't hit the real DB
vi.mock("../conversation-state-store", async () => {
  const actual =
    await vi.importActual<typeof import("../conversation-state-store")>(
      "../conversation-state-store",
    );
  return {
    ...actual,
    loadRuntimeState: vi.fn(),
    saveRuntimeState: vi.fn(),
    clearRuntimeState: vi.fn(),
  };
});

import { vi } from "vitest";

const mockLoad = vi.mocked(store.loadRuntimeState);

describe("runtime-state-bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset legacy Map by clearing each known convId
    clearPendingHumanAction("test-conv");
  });

  // ── Test 1: undefined when no RuntimeState ────────────────────────────────────
  it("bridgeRuntimeToLegacy returns undefined when no RuntimeState", async () => {
    mockLoad.mockResolvedValue(null);
    const result = await bridgeRuntimeToLegacy("test-conv");
    expect(result).toBeUndefined();
  });

  // ── Test 2: maps human → legacy fields ────────────────────────────────────────
  it("bridgeRuntimeToLegacy maps human.pendingAction → legacy fields", async () => {
    mockLoad.mockResolvedValue({
      human: {
        pendingAction: {
          type: "select",
          entityType: "user",
          candidates: [{ id: "u1", label: "刘工", summary: "liuyipeng@cary.com" }],
          query: "刘工的周报",
        },
        originalQuery: "刘工的周报",
        resolvedEntities: null,
        waitingNode: "humanConfirmation",
        lastAssistantMessage: "需要确认是哪个刘工",
        mode: "search",
      },
    });

    const result = await bridgeRuntimeToLegacy("test-conv");
    expect(result).toBeDefined();
    expect(result!.pendingHumanAction.type).toBe("select");
    expect(result!.pendingHumanAction.entityType).toBe("user");
    expect(result!.pendingHumanAction.candidates).toHaveLength(1);
    expect(result!.lastAssistantMessage).toBe("需要确认是哪个刘工");
    expect(result!.mode).toBe("search");
  });

  // ── Test 3: extracts lastMentionedUser from resolvedEntities ─────────────────
  it("bridgeRuntimeToLegacy extracts lastMentionedUser from resolvedEntities", async () => {
    mockLoad.mockResolvedValue({
      human: {
        pendingAction: { type: "select", entityType: "user", candidates: [], query: "x" },
        originalQuery: "x",
        resolvedEntities: { id: "u123", name: "刘屹鹏" },
        waitingNode: null,
        lastAssistantMessage: "",
        mode: "auto",
      },
    });

    const result = await bridgeRuntimeToLegacy("test-conv");
    expect(result?.lastMentionedUser).toEqual({ id: "u123", name: "刘屹鹏" });
  });

  it("bridgeRuntimeToLegacy leaves lastMentionedUser undefined when no resolvedEntities", async () => {
    mockLoad.mockResolvedValue({
      human: {
        pendingAction: null,
        originalQuery: "x",
        resolvedEntities: null,
        waitingNode: null,
        lastAssistantMessage: "",
        mode: "auto",
      },
    });

    const result = await bridgeRuntimeToLegacy("test-conv");
    expect(result?.lastMentionedUser).toBeUndefined();
  });

  // ── Test 4: Map fallback chain ────────────────────────────────────────────────
  it("getPendingHumanAction returns Map fallback when DB has no pending", async () => {
    mockLoad.mockResolvedValue(null);

    // Pre-populate legacy Map
    const legacyState: PendingHumanActionState = {
      pendingHumanAction: {
        type: "select",
        entityType: "user",
        candidates: [{ id: "u2", label: "张工", summary: "zhang@cary.com" }],
        query: "张工的周报",
      },
      lastAssistantMessage: "需要确认张工",
      mode: "search",
    };
    setPendingHumanAction("test-conv", legacyState);

    const result = await getPendingHumanAction("test-conv");
    expect(result).toEqual(legacyState);
  });

  it("getPendingHumanAction prefers DB over Map when both exist", async () => {
    mockLoad.mockResolvedValue({
      human: {
        pendingAction: {
          type: "select",
          entityType: "user",
          candidates: [{ id: "db-u", label: "DB 优先", summary: "db" }],
          query: "from DB",
        },
        originalQuery: "from DB",
        resolvedEntities: null,
        waitingNode: null,
        lastAssistantMessage: "DB message",
        mode: "search",
      },
    });

    setPendingHumanAction("test-conv", {
      pendingHumanAction: {
        type: "select",
        entityType: "user",
        candidates: [{ id: "map-u", label: "Map 兜底", summary: "map" }],
        query: "from Map",
      },
      lastAssistantMessage: "Map message",
      mode: "auto",
    });

    const result = await getPendingHumanAction("test-conv");
    expect(result?.lastAssistantMessage).toBe("DB message");
    expect(result?.mode).toBe("search");
  });

  // ── Test 5: clearPendingHumanAction removes Map entry ────────────────────────
  it("clearPendingHumanAction removes Map entry", async () => {
    mockLoad.mockResolvedValue(null);

    setPendingHumanAction("test-conv", {
      pendingHumanAction: {
        type: "select",
        entityType: "user",
        candidates: [],
        query: "x",
      },
      lastAssistantMessage: "",
      mode: "auto",
    });
    clearPendingHumanAction("test-conv");

    const result = await getPendingHumanAction("test-conv");
    expect(result).toBeUndefined();
  });
});
