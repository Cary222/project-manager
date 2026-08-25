import { describe, expect, it } from "vitest";
import { resolveForkLeaf, type ForkLeafEntry } from "../fork-leaf";

const msg = (id: string, parentId: string | null, role: string): ForkLeafEntry => ({
  id,
  parentId,
  type: "message",
  message: { role },
});

describe("resolveForkLeaf", () => {
  // 典型回合结构：U1 → A1(tool_use) → TR1 → A2(最终文本) → U2 → A3
  const u1 = msg("u1", null, "user");
  const a1Tool = msg("a1", "u1", "assistant");
  const tr1 = msg("tr1", "a1", "toolResult");
  const a2Final = msg("a2", "tr1", "assistant");
  const u2 = msg("u2", "a2", "user");
  const a3 = msg("a3", "u2", "assistant");
  const entries = [u1, a1Tool, tr1, a2Final, u2, a3];

  it("AI 回答是叶子：包含它自己（而非其父节点）", () => {
    expect(resolveForkLeaf(entries, "a3")).toBe("a3");
  });

  it("带工具调用的中间回答：包含到回合末尾", () => {
    expect(resolveForkLeaf(entries, "a1")).toBe("a2");
    expect(resolveForkLeaf(entries, "tr1")).toBe("a2");
  });

  it("用户消息：排除该问题，维持旧行为", () => {
    expect(resolveForkLeaf(entries, "u2")).toBe("a2");
    expect(() => resolveForkLeaf(entries, "u1")).toThrow(/no parent/);
  });

  it("不存在的 entryId：抛错", () => {
    expect(() => resolveForkLeaf(entries, "nope")).toThrow(/not found/);
  });
});
