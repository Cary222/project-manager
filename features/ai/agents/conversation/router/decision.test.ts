import { describe, expect, it } from "vitest";
import { decideChatRoute } from "./decision";

describe("decideChatRoute - Lightweight semantic router", () => {
  it("fast-path classifies greetings into chat mode in 0ms", async () => {
    const greetings = [
      "你好",
      "您好",
      "在吗",
      "嗨",
      "hello",
      "早上好",
      "谢谢你",
      "好的好的",
    ];
    for (const g of greetings) {
      const res = await decideChatRoute(g);
      expect(res.mode).toBe("chat");
      expect(res.confidence).toBe(1.0);
    }
  });

  it("fast-path classifies self-identity and capabilities questions into chat mode in 0ms", async () => {
    const questions = [
      "你是谁",
      "你叫什么名字",
      "介绍一下你自己",
      "你能做什么",
      "你有什么功能",
      "你可以帮我做什么",
    ];
    for (const q of questions) {
      const res = await decideChatRoute(q);
      expect(res.mode).toBe("chat");
      expect(res.confidence).toBe(1.0);
    }
  });

  it("fast-path classifies image and video creation requests in 0ms", async () => {
    const imgRes = await decideChatRoute("帮我生成一张太空飞船的图片");
    expect(imgRes.mode).toBe("image");

    const vidRes = await decideChatRoute("制作一个短视频展示产品外观");
    expect(vidRes.mode).toBe("video");
  });

  it("internal query falls back safely to search mode without throwing", async () => {
    const res = await decideChatRoute("查询最近延期的工单列表", {
      timeoutMs: 50,
    });
    expect(["search", "workflow"]).toContain(res.mode);
  });
});
