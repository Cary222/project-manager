import { describe, expect, it } from "vitest";
import { toResultType } from "@/shared/lib/search";

describe("toResultType", () => {
  it.each([
    ["TICKET", "ticket"],
    ["COMMIT", "commit"],
    ["PKM_NOTE", "note"],
    ["DOCUMENT", "doc"],
  ] as const)("maps %s to %s", (sourceType, resultType) => {
    expect(toResultType(sourceType)).toBe(resultType);
  });

  it("ignores unknown source types", () => {
    expect(toResultType("KNOWLEDGE_DOC")).toBeNull();
  });
});
