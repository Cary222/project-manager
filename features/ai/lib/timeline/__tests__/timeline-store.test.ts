/**
 * TimelineStore — unit tests.
 *
 * Coverage:
 *   1. applyCommand("create")  inserts task
 *   2. applyCommand("update")  patches existing task without losing fields
 *   3. applyCommand("delete")  removes task
 *   4. applyCommand("snapshot") replaces entire map
 *   5. onUpdate subscriber is notified after every mutation
 *   6. Listener exceptions are isolated — one bad listener doesn't break others
 */

import { describe, it, expect, vi } from "vitest";
import { TimelineStore } from "../timeline-store";
import type { TaskRecord } from "@/features/ai/types/timeline";

function mockTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "exec-1",
    parentId: null,
    stepLabel: "意图识别",
    title: "正在理解你的问题",
    status: "running",
    startTime: 1_000,
    category: "reason",
    ...overrides,
  };
}

describe("TimelineStore", () => {
  // ── Test 1: create ──────────────────────────────────────────────────────────
  it("applies a create command and exposes the task via getTasks", () => {
    const store = new TimelineStore();
    const task = mockTask();
    store.applyCommand({ op: "create", task });

    expect(store.size()).toBe(1);
    expect(store.getTask(task.id)).toEqual(task);
    expect(store.isEmpty()).toBe(false);
  });

  // ── Test 2: update preserves untouched fields ───────────────────────────────
  it("applies an update command that merges over the existing task", () => {
    const store = new TimelineStore();
    const task = mockTask({ status: "running" });
    store.applyCommand({ op: "create", task });

    store.applyCommand({
      op: "update",
      id: task.id,
      updates: { status: "success", endTime: 2_000, detail: "已完成" },
    });

    const updated = store.getTask(task.id);
    expect(updated?.status).toBe("success");
    expect(updated?.endTime).toBe(2_000);
    expect(updated?.detail).toBe("已完成");
    // Untouched fields stay intact — proves Object.assign-style merge, not replace
    expect(updated?.title).toBe(task.title);
    expect(updated?.startTime).toBe(task.startTime);
    expect(updated?.category).toBe(task.category);
  });

  // ── Test 3: delete ──────────────────────────────────────────────────────────
  it("applies a delete command and removes the task", () => {
    const store = new TimelineStore();
    store.applyCommand({ op: "create", task: mockTask() });
    expect(store.size()).toBe(1);

    store.applyCommand({ op: "delete", id: "exec-1" });
    expect(store.size()).toBe(0);
    expect(store.getTask("exec-1")).toBeUndefined();
    expect(store.isEmpty()).toBe(true);
  });

  // ── Test 4: snapshot replaces the entire map ───────────────────────────────
  it("applies a snapshot command by replacing all tasks", () => {
    const store = new TimelineStore();
    store.applyCommand({ op: "create", task: mockTask({ id: "old" }) });
    expect(store.size()).toBe(1);

    store.applyCommand({
      op: "snapshot",
      tasks: [mockTask({ id: "new-1" }), mockTask({ id: "new-2" })],
    });

    expect(store.size()).toBe(2);
    expect(store.getTask("old")).toBeUndefined();
    expect(store.getTask("new-1")).toBeDefined();
    expect(store.getTask("new-2")).toBeDefined();
  });

  // ── Test 5: subscribers receive a Map snapshot on every mutation ────────────
  it("notifies subscribers with a fresh Map snapshot after each mutation", () => {
    const store = new TimelineStore();
    const callback = vi.fn();
    const unsubscribe = store.onUpdate(callback);

    store.applyCommand({ op: "create", task: mockTask() });
    store.applyCommand({ op: "update", id: "exec-1", updates: { status: "success" } });

    expect(callback).toHaveBeenCalledTimes(2);
    // First call: snapshot with the create
    expect(callback.mock.calls[0][0].size).toBe(1);
    // Second call: snapshot with the update applied
    expect(callback.mock.calls[1][0].get("exec-1")?.status).toBe("success");

    unsubscribe();
    store.applyCommand({ op: "clear" } as never);
    // After unsubscribe no further calls
    expect(callback).toHaveBeenCalledTimes(2);
  });

  // ── Test 6: one bad listener must not break sibling listeners ──────────────
  it("isolates listener exceptions so a bad subscriber doesn't break others", () => {
    const store = new TimelineStore();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });

    store.onUpdate(bad);
    store.onUpdate(good);

    store.applyCommand({ op: "create", task: mockTask() });

    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[TimelineStore] listener error:",
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
