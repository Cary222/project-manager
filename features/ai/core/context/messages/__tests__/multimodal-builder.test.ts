/**
 * multimodal-builder + messages-builder multimodal integration tests.
 *
 * 覆盖：
 *   1. buildMultimodalContent：无图片退化为 string
 *   2. buildMultimodalContent：有图片返回 array with text + image_url parts
 *   3. extractTextAndImageUrls：双向转换
 *   4. messages-builder 接收 currentInput.imageUrls 后，构造 HumanMessage.content 是 array
 *   5. messages-builder 用 historyImageUrls 重建历史 user message 为多模态
 */

import { describe, it, expect } from "vitest";
import { buildMultimodalContent, extractTextAndImageUrls } from "../multimodal-builder";
import { buildMessages } from "../messages-builder";

describe("buildMultimodalContent", () => {
  it("returns plain string when imageUrls is empty", () => {
    expect(buildMultimodalContent("hello")).toBe("hello");
    expect(buildMultimodalContent("hello", [])).toBe("hello");
    expect(buildMultimodalContent("hello", undefined)).toBe("hello");
  });

  it("returns array with text + image_url parts when images present", () => {
    const result = buildMultimodalContent("describe this", [
      "data:image/jpeg;base64,abc",
      "data:image/jpeg;base64,def",
    ]);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: "text", text: "describe this" });
      expect(result[1]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,abc" },
      });
      expect(result[2]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64,def" },
      });
    }
  });
});

describe("extractTextAndImageUrls", () => {
  it("returns text and empty imageUrls for string content", () => {
    const r = extractTextAndImageUrls("hello world");
    expect(r.text).toBe("hello world");
    expect(r.imageUrls).toEqual([]);
  });

  it("extracts text and imageUrls from array content", () => {
    const r = extractTextAndImageUrls([
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: "data:abc" } },
      { type: "image_url", image_url: { url: "data:def" } },
    ]);
    expect(r.text).toBe("describe this");
    expect(r.imageUrls).toEqual(["data:abc", "data:def"]);
  });

  it("concatenates multiple text parts", () => {
    const r = extractTextAndImageUrls([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
    expect(r.text).toBe("first\n\nsecond");
  });
});

describe("buildMessages with multimodal input", () => {
  it("appends current HumanMessage with array content when imageUrls provided", () => {
    const result = buildMessages({
      history: [],
      currentInput: {
        text: "describe this",
        imageUrls: ["data:image/jpeg;base64,abc"],
      },
    });

    expect(result).toHaveLength(1);
    const current = result[0];
    expect(current.getType()).toBe("human");
    // content 应该是 array（多模态）
    expect(Array.isArray(current.content)).toBe(true);
    if (Array.isArray(current.content)) {
      expect(current.content).toHaveLength(2);
      expect((current.content[0] as { type: string; text: string }).text).toBe("describe this");
      expect((current.content[1] as { type: string; image_url: { url: string } }).image_url.url).toBe(
        "data:image/jpeg;base64,abc"
      );
    }
  });

  it("uses string content when no images provided (backward compatible)", () => {
    const result = buildMessages({
      history: [],
      currentMessage: "just text",
    });

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("just text");
  });

  it("reconstructs historical user message as multimodal when historyImageUrls provided", () => {
    const history = [
      { id: "h1", role: "user", content: "what is this?" },
      { id: "h2", role: "assistant", content: "it's a cat" },
    ];
    const historyImageUrls = new Map([
      ["h1", ["data:image/jpeg;base64,catpic"]],
    ]);

    const result = buildMessages({
      history,
      currentInput: { text: "what breed?" },
      historyImageUrls,
    });

    // history user (multimodal) + history assistant + current user (no image)
    expect(result).toHaveLength(3);

    const histUser = result[0];
    expect(histUser.getType()).toBe("human");
    expect(Array.isArray(histUser.content)).toBe(true);
    if (Array.isArray(histUser.content)) {
      const textPart = histUser.content.find((p) => p.type === "text") as { type: string; text: string };
      const imagePart = histUser.content.find((p) => p.type === "image_url") as { type: string; image_url: { url: string } };
      expect(textPart?.text).toBe("what is this?");
      expect(imagePart?.image_url.url).toBe("data:image/jpeg;base64,catpic");
    }

    // 历史 assistant 仍然 string content
    expect(result[1].getType()).toBe("ai");
    expect(result[1].content).toBe("it's a cat");

    // 当前 user message：string（无 imageUrls）
    expect(result[2].getType()).toBe("human");
    expect(result[2].content).toBe("what breed?");
  });

  it("treats history user message as string content when no entry in historyImageUrls", () => {
    const history = [{ id: "h1", role: "user", content: "no image" }];

    const result = buildMessages({
      history,
      currentMessage: "continue",
    });

    const histUser = result[0];
    expect(histUser.content).toBe("no image"); // string fallback
  });
});