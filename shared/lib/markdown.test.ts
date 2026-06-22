import { describe, expect, it } from "vitest";
import { cleanMarkdownForEmbedding, formatAttachmentLabel } from "@/shared/lib/markdown";

describe("cleanMarkdownForEmbedding", () => {
  it("strips inline data:image base64 payloads", () => {
    const base64 = "iVBORw0KGgo".repeat(2000);
    const markdown = `## 截图说明\n\n看下面这张图：\n\n![截图](data:image/png;base64,${base64})\n\n这是正文。`;

    const cleaned = cleanMarkdownForEmbedding(markdown);

    expect(cleaned).not.toContain("data:image/png;base64");
    expect(cleaned).not.toContain("iVBORw0KGgo");
    expect(cleaned.length).toBeLessThan(markdown.length / 10);
    expect(cleaned).toContain("截图说明");
    expect(cleaned).toContain("这是正文");
  });

  it("replaces external markdown image syntax with alt text", () => {
    const markdown = `## 图示\n\n![架构图](https://example.com/diagram.png)\n\n补充说明。`;

    const cleaned = cleanMarkdownForEmbedding(markdown);

    expect(cleaned).not.toContain("https://example.com/diagram.png");
    expect(cleaned).toContain("架构图");
    expect(cleaned).toContain("补充说明");
  });

  it("collapses markdown link syntax to visible text", () => {
    const markdown = `参考资料：\n\n请阅读 [Next.js 文档](https://nextjs.org/docs) 和 [Prisma 指南](https://www.prisma.io/docs)。`;

    const cleaned = cleanMarkdownForEmbedding(markdown);

    expect(cleaned).toContain("Next.js 文档");
    expect(cleaned).toContain("Prisma 指南");
    expect(cleaned).not.toContain("https://nextjs.org/docs");
    expect(cleaned).not.toContain("https://www.prisma.io/docs");
  });

  it("removes fenced code fences but keeps code content", () => {
    const markdown = `\`\`\`ts\nconst greeting = "hello";\nconsole.log(greeting);\n\`\`\`\n\n上面是示例代码。`;

    const cleaned = cleanMarkdownForEmbedding(markdown);

    expect(cleaned).toContain('const greeting = "hello"');
    expect(cleaned).toContain("console.log(greeting)");
    expect(cleaned).not.toContain("```");
    expect(cleaned).toContain("上面是示例代码");
  });

  it("strips markdown heading, list, blockquote and table separators", () => {
    const markdown = [
      "## 虚拟列表原理",
      "",
      "- 优点：实现简单",
      "- 缺点：不够灵活",
      "",
      "> 来自官方文档",
      "",
      "| 方案 | 优点 | 缺点 |",
      "| --- | --- | --- |",
      "| 固定高度 | 简单 | 不灵活 |",
      "",
      "---",
      "",
      "正文段落结束。",
    ].join("\n");

    const cleaned = cleanMarkdownForEmbedding(markdown);

    expect(cleaned).not.toMatch(/^#/m);
    expect(cleaned).not.toMatch(/^\s*-\s/m);
    expect(cleaned).not.toMatch(/^>+/m);
    expect(cleaned).not.toContain("|");
    expect(cleaned).not.toMatch(/^---+$/m);
    expect(cleaned).toContain("虚拟列表原理");
    expect(cleaned).toContain("优点：实现简单");
    expect(cleaned).toContain("来自官方文档");
    expect(cleaned).toContain("固定高度");
    expect(cleaned).toContain("正文段落结束");
  });

  it("collapses multiple blank lines into at most two newlines", () => {
    const markdown = `第一段。\n\n\n\n\n第二段。\n\n\n\n第三段。`;

    const cleaned = cleanMarkdownForEmbedding(markdown);

    expect(cleaned).not.toMatch(/\n{3,}/);
    expect(cleaned).toBe("第一段。\n\n第二段。\n\n第三段。");
  });

  it("returns empty string for empty or whitespace-only input", () => {
    expect(cleanMarkdownForEmbedding("")).toBe("");
    expect(cleanMarkdownForEmbedding("   \n\n  ")).toBe("");
  });
});

describe("formatAttachmentLabel", () => {
  it("renders filename with mime type in parentheses", () => {
    expect(formatAttachmentLabel({ name: "benchmark.png", mimeType: "image/png" })).toBe(
      "benchmark.png (image/png)"
    );
  });

  it("falls back to filename when mime type is missing", () => {
    expect(formatAttachmentLabel({ name: "notes.pdf", mimeType: "" })).toBe("notes.pdf");
  });

  it("trims surrounding whitespace from name and mime type", () => {
    expect(formatAttachmentLabel({ name: "  deck.pptx  ", mimeType: "  application/vnd.ms-powerpoint  " })).toBe(
      "deck.pptx (application/vnd.ms-powerpoint)"
    );
  });
});
