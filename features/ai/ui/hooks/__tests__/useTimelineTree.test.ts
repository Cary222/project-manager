/**
 * useTimelineTree — unit tests for the pure `buildTree` algorithm.
 *
 * Coverage:
 *   1. Flat records (parentId=null) → all root nodes
 *   2. Records with parentId → children attach to the right parent
 *   3. Siblings are sorted by startTime ascending
 */

import { describe, it, expect } from "vitest";
import { buildTree } from "../useTimelineTree";
import type { TaskRecord } from "@/features/ai/types/timeline";

function rec(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "id",
    parentId: null,
    stepLabel: "label",
    title: "title",
    status: "success",
    startTime: 0,
    category: "reason",
    ...overrides,
  };
}

describe("buildTree", () => {
  // ── Test 1: all roots ───────────────────────────────────────────────────────
  it("treats every record as a root when parentId is null", () => {
    const records = [
      rec({ id: "a", startTime: 100 }),
      rec({ id: "b", startTime: 200 }),
      rec({ id: "c", startTime: 300 }),
    ];
    const tree = buildTree(records);

    expect(tree).toHaveLength(3);
    expect(tree.map((n) => n.id)).toEqual(["a", "b", "c"]);
    tree.forEach((n) => expect(n.children).toEqual([]));
  });

  // ── Test 2: parent-child attachment ────────────────────────────────────────
  it("attaches children under their parent when parentId is set", () => {
    const records = [
      rec({ id: "root", parentId: null, startTime: 100 }),
      rec({ id: "child-1", parentId: "root", startTime: 150 }),
      rec({ id: "child-2", parentId: "root", startTime: 180 }),
      rec({ id: "other-root", parentId: null, startTime: 200 }),
    ];
    const tree = buildTree(records);

    expect(tree).toHaveLength(2);
    const root = tree.find((n) => n.id === "root");
    expect(root).toBeDefined();
    expect(root?.children).toHaveLength(2);
    expect(root?.children.map((c) => c.id).sort()).toEqual(["child-1", "child-2"]);
  });

  // ── Test 3: sort siblings by startTime ─────────────────────────────────────
  it("sorts siblings by startTime ascending (and recursively for children)", () => {
    const records = [
      rec({ id: "late", parentId: null, startTime: 500 }),
      rec({ id: "early", parentId: null, startTime: 100 }),
      rec({ id: "mid", parentId: "early", startTime: 250 }),
      rec({ id: "earliest-child", parentId: "early", startTime: 150 }),
    ];
    const tree = buildTree(records);

    // Roots: early then late
    expect(tree.map((n) => n.id)).toEqual(["early", "late"]);

    // Children of "early": earliest-child then mid
    const earlyNode = tree[0];
    expect(earlyNode.children.map((c) => c.id)).toEqual([
      "earliest-child",
      "mid",
    ]);
  });
});
