/**
 * history-window picture token cost tests (W1 fix).
 *
 * 覆盖：
 *   1. 不带 historyImageUrls 时：行为与旧版一致（纯文本 cost）
 *   2. 带图消息的 cost = 文本 + N × 700 token
 *   3. 超预算时优先淘汰带图旧轮次（保留纯文本）
 *   4. PICTURE_TOKEN_COST 常量导出便于其他模块复用
 */

import { describe, it, expect } from "vitest";
import {
  truncateHistoryByToken,
  PICTURE_TOKEN_COST,
} from "../history-window";

describe("truncateHistoryByToken picture cost (W1)", () => {
  it("PICTURE_TOKEN_COST is 700 (OpenAI low-detail convention)", () => {
    expect(PICTURE_TOKEN_COST).toBe(700);
  });

  it("backward compatible: no historyImageUrls → only text cost counted", () => {
    const longText = "x".repeat(500); // ~500 tokens
    const history = [
      { id: "1", role: "user", content: longText },
      { id: "2", role: "assistant", content: longText },
    ];

    const result = truncateHistoryByToken(history, {
      historyTokenLimit: 600,
      systemAndRagTokenLimit: 0,
      currentMessage: "",
    });

    // 至少 1 条入窗（500 tokens < 600 budget）
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("picture messages cost extra ~700 tokens each", () => {
    // 文本 ≈ 100 tokens + 1 张图 = 800 token cost
    const shortText = "describe this image";
    const history = [
      { id: "1", role: "user", content: shortText },
      { id: "2", role: "assistant", content: shortText },
    ];
    const historyImageUrls = new Map([
      ["1", ["data:image/jpeg;base64,abc"]],
    ]);

    // 预算 600 tokens：无图时 2 条都能挤进（≈100 + 4 + 100 + 4 ≈ 208 tokens），
    // 加图后 cost ≈ 100 + 4 + 700 + 100 + 4 ≈ 908 → 应被截断到只剩 1 条
    const result = truncateHistoryByToken(history, {
      historyTokenLimit: 600,
      systemAndRagTokenLimit: 0,
      currentMessage: "",
      historyImageUrls,
    });

    // 加图后成本超过预算，只保留最后 1 条无图消息（id=2）
    // 或两条都超（id=1 with image + id=2 一起也 > 600）→ 至少 id=2 进
    expect(result.length).toBeLessThanOrEqual(1);
    expect(result.find((m) => m.id === "1")).toBeUndefined();
  });

  it("prioritizes keeping pure-text rounds when image rounds are expensive", () => {
    // 场景：5 轮对话，2 轮带图（m2 带 3 张图、new 带 1 张图）。预算有限。
    const shortText = "hi";
    const history = [
      { id: "old", role: "user", content: shortText }, // 纯文本
      { id: "m1", role: "assistant", content: shortText },
      { id: "m2", role: "user", content: shortText }, // 带 3 张图
      { id: "m3", role: "assistant", content: shortText },
      { id: "new", role: "user", content: shortText }, // 带 1 张图
    ];
    const historyImageUrls = new Map([
      ["m2", ["data:img1", "data:img2", "data:img3"]],
      ["new", ["data:imgA"]],
    ]);

    // 预算 1500 tokens：
    // - "new" 带图：~704
    // - "m3": ~6
    // - "m2" 带图：~2106 → 超预算 → reject
    // - "m1": ~6
    // - "old": ~6
    // 总计：722 tokens
    const result = truncateHistoryByToken(history, {
      historyTokenLimit: 1500,
      systemAndRagTokenLimit: 0,
      currentMessage: "",
      historyImageUrls,
    });

    // m2 因成本太高被淘汰；其余 4 条都挤进窗口
    expect(result.map((m) => m.id)).toEqual(["old", "m1", "m3", "new"]);
    expect(result.find((m) => m.id === "m2")).toBeUndefined();
  });

  it("empty historyImageUrls map behaves same as undefined", () => {
    const history = [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "hi" },
    ];

    const withoutMap = truncateHistoryByToken(history, {
      historyTokenLimit: 1000,
      systemAndRagTokenLimit: 0,
      currentMessage: "",
    });
    const withEmptyMap = truncateHistoryByToken(history, {
      historyTokenLimit: 1000,
      systemAndRagTokenLimit: 0,
      currentMessage: "",
      historyImageUrls: new Map(),
    });

    expect(withEmptyMap.map((m) => m.id)).toEqual(withoutMap.map((m) => m.id));
  });
});