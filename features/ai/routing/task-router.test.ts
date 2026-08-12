/**
 * task-router.test.ts — Tests for frontend lightweight intent resolution.
 *
 * Test coverage (19 cases):
 * 1. 明确生成图片（5 个）
 * 2. 明确生成 > 附带讨论词（2 个）
 * 3. 讨论/查询类 → chat（8 个）
 * 4. 知识库检索（1 个）
 * 5. 联网搜索（1 个）
 * 6. 通用对话（1 个）
 * 7. 回归：单独"画"字（1 个）← Critical bug fix
 */
import { describe, expect, it } from "vitest";
import { resolveIntent, getTaskHint, type ResolvedAiIntent } from "./task-router";

describe("resolveIntent", () => {
  // ─── 明确生成图片（5 个）─────────────────────────────────────────────────────
  describe("明确生成图片", () => {
    const imageCases: Array<[string, string]> = [
      ["帮我生成一张图片：日落海边", "image"],
      ["请画一幅风景画", "image"],
      ["帮我创作一张海报", "image"],
      ["制作一张封面图片", "image"],
      ["生成一张照片风格的图", "image"],
    ];

    imageCases.forEach(([input, expected]) => {
      it(`"${input}" → ${expected}`, () => {
        expect(resolveIntent(input).category).toBe(expected);
      });
    });
  });

  // ─── 明确生成 > 附带讨论词（2 个）─────────────────────────────────────────────
  describe("明确生成附带讨论词", () => {
    it("附带讨论词仍判定为 image", () => {
      // "怎么生成" 在图片生成场景下仍应该识别为图片（因为前面有明确的生成意图词）
      const result = resolveIntent("帮我生成一张图片，怎么做比较好？");
      expect(result.category).toBe("image");
    });

    it("生成视频附带讨论仍为 video", () => {
      const result = resolveIntent("帮我制作一个视频，怎么做？");
      expect(result.category).toBe("video");
    });
  });

  // ─── 讨论/查询类 → chat（8 个）────────────────────────────────────────────────
  describe("讨论查询类 → chat", () => {
    const chatCases: Array<[string, string | undefined]> = [
      ["怎么部署 Next.js 项目？", "chat"],
      ["这个 bug 是怎么产生的？", "chat"],
      ["React 的原理是什么？", "chat"],
      ["为什么我的代码运行这么慢？", "chat"],
      ["哪个前端框架比较好？", "chat"],
      ["有哪些推荐的 AI 工具？", "chat"],
      ["对比一下 Vue 和 React", "chat"],
      ["介绍一下微服务架构", "chat"],
    ];

    chatCases.forEach(([input, expected]) => {
      it(`"${input}" → ${expected}`, () => {
        expect(resolveIntent(input).category).toBe(expected);
        expect(resolveIntent(input).toolMode ?? "chat").toBe("chat");
      });
    });
  });

  // ─── 知识库检索（1 个）───────────────────────────────────────────────────────
  describe("知识库检索", () => {
    it("知识库关键词 → search", () => {
      const result = resolveIntent("在知识库里搜索 React 的内容");
      expect(result.category).toBe("chat");
      expect(result.toolMode).toBe("search");
    });
  });

  // ─── 联网搜索（1 个）────────────────────────────────────────────────────────
  describe("联网搜索", () => {
    it("联网关键词 → web", () => {
      const result = resolveIntent("联网搜索最新的人工智能新闻");
      expect(result.category).toBe("chat");
      expect(result.toolMode).toBe("web");
    });
  });

  // ─── 通用对话（1 个）────────────────────────────────────────────────────────
  describe("通用对话", () => {
    it("无特定模式 → chat", () => {
      const result = resolveIntent("今天天气真不错");
      expect(result.category).toBe("chat");
    });
  });

  // ─── 回归：单独"画"字（1 个）───────────────────────────────────────────────
  describe("回归：单独画字误触发", () => {
    it('"帮我画画" → chat（不是 image）', () => {
      const result = resolveIntent("帮我画画");
      expect(result.category).toBe("chat");
    });

    it('"画" 单字 → chat', () => {
      const result = resolveIntent("画");
      expect(result.category).toBe("chat");
    });
  });
});

describe("getTaskHint", () => {
  it("image intent → 'image'", () => {
    expect(getTaskHint({ category: "image" })).toBe("image");
  });

  it("video intent → 'video'", () => {
    expect(getTaskHint({ category: "video" })).toBe("video");
  });

  it("chat intent → undefined", () => {
    expect(getTaskHint({ category: "chat" })).toBeUndefined();
  });
});
