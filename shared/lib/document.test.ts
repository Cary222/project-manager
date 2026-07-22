import { describe, expect, it } from "vitest";
import { decodeTextBytes } from "@/shared/lib/document";

describe("decodeTextBytes", () => {
  it("decodes Prisma Uint8Array bytes as UTF-8 text", () => {
    const markdown = "# AI 工具链优化\n\n向量检索与 Worker 修复";
    const bytes = new TextEncoder().encode(markdown);

    expect(decodeTextBytes(bytes)).toBe(markdown);
  });
});
