/**
 * TimelineAdapter — unit tests.
 *
 * Coverage:
 *   1. extractDetail from toolResults.count → "找到 N 条记录"
 *   2. extractDetail from candidates array → joined labels (truncated to 4)
 *   3. extractDetail from resolvedEntities → "已确认：<name>"
 *   4. extractDetail from response string → preview (truncated to 30 chars)
 *   5. extractDetail from pendingHumanAction → "等待确认"
 *
 * Tests target the exported `extractDetail` directly because it is the heart of
 * the "graph events → user language" translation. The `adaptGraphChunk` /
 * `onNodeStart` / `onNodeEnd` orchestration is exercised indirectly through
 * the integration test in route.ts.
 */

import { describe, it, expect } from "vitest";
import { extractDetail } from "../timeline-adapter";

describe("extractDetail", () => {
  // ── Test 1: toolResults.count ──────────────────────────────────────────────
  it("formats toolResults.count as '找到 N 条记录'", () => {
    const detail = extractDetail({
      toolResults: {
        searchStructured: { count: 12 },
      },
    });
    expect(detail).toBe("找到 12 条记录");
  });

  // ── Test 2: candidates array → joined labels (truncated at 4 + suffix) ────
  it("joins candidate labels with ' · ' and appends '等N个' when >4", () => {
    const detail = extractDetail({
      candidates: [
        { label: "1. cary（刘屹鹏）" },
        { label: "2. alice" },
        { label: "3. bob" },
        { label: "4. carol" },
        { label: "5. dave" },
        { label: "6. erin" },
      ],
    });
    expect(detail).toBe("1. cary（刘屹鹏） · 2. alice · 3. bob · 4. carol等6个");
  });

  // ── Test 3: resolvedEntities → "已确认：<user name>" ────────────────────────
  it("extracts user name from resolvedEntities.user", () => {
    const detail = extractDetail({
      resolvedEntities: { user: { id: "u1", name: "cary（刘屹鹏）" } },
    });
    expect(detail).toBe("已确认：cary（刘屹鹏）");
  });

  // ── Test 4: response preview truncated to 30 chars + ellipsis ──────────────
  it("truncates long response strings to a 30-char preview", () => {
    const long = "这段回答包含了很多内容应该被截断掉后面省略".repeat(3);
    const detail = extractDetail({ response: long });
    expect(detail).toBeDefined();
    expect(detail?.length).toBeLessThanOrEqual(31); // 30 + ellipsis
    expect(detail?.endsWith("…")).toBe(true);
  });

  // ── Test 5: pendingHumanAction → "等待确认" ─────────────────────────────────
  it("returns '等待确认' when pendingHumanAction is set", () => {
    const detail = extractDetail({
      pendingHumanAction: {
        type: "select",
        entity: "user",
        candidates: [],
      },
    });
    expect(detail).toBe("等待确认");
  });
});
