import { describe, expect, it } from "vitest";
import {
  extractUserIdentifier,
  parseQueryType,
} from "@/features/ai/core/resolvers/query-parser";
import { resolveUser } from "@/features/ai/core/resolvers/user-resolver";
import { detectMode } from "../detect-intent";

describe("P0 Bugfix: Greetings and non-names never trigger user disambiguation", () => {
  const greetings = [
    "你好",
    "您好",
    "在吗",
    "在不在",
    "早上好",
    "下午好",
    "晚上好",
    "哈喽",
    "嗨",
    "谢谢你",
    "好的好的",
  ];

  it("extractUserIdentifier returns undefined for all common greetings", () => {
    for (const g of greetings) {
      expect(extractUserIdentifier(g)).toBeUndefined();
    }
  });

  it("parseQueryType returns ambiguous for all common greetings (never 'user')", () => {
    for (const g of greetings) {
      expect(parseQueryType(g)).toBe("ambiguous");
    }
  });

  it("detectMode classifies all common greetings as 'chat' mode", () => {
    for (const g of greetings) {
      expect(detectMode(g)).toBe("chat");
    }
  });

  it("resolveUser immediately rejects greetings without querying database", async () => {
    for (const g of greetings) {
      const res = await resolveUser({ raw: g, normalized: g }, undefined);
      expect(res.user).toBeNull();
      expect(res.candidates).toBeUndefined();
      expect(res.confidence).toBe(0);
    }
  });

  it("real person query still extracts and classifies as 'user'", () => {
    const query = "刘工最近在干什么";
    expect(extractUserIdentifier(query)?.raw).toBe("刘工");
    expect(parseQueryType(query)).toBe("user");
  });
});
