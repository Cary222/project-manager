import { describe, expect, it } from "vitest";
import { THINKING_OPTIONS } from "../AiChatInput";
import { isReasoningLevel } from "@/features/ai/llm/model-reasoning";

describe("Thinking level and options contract", () => {
  it("should contain standard thinking levels (high, medium, low, off)", () => {
    const values = THINKING_OPTIONS.map((opt) => opt.value);
    expect(values).toEqual(["high", "medium", "low", "off"]);
  });

  it("all options should be valid ReasoningLevels", () => {
    for (const option of THINKING_OPTIONS) {
      expect(isReasoningLevel(option.value)).toBe(true);
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.desc.length).toBeGreaterThan(0);
    }
  });

  it("default option should be High for deep reasoning", () => {
    expect(THINKING_OPTIONS[0].value).toBe("high");
    expect(THINKING_OPTIONS[0].label).toBe("High");
  });
});
