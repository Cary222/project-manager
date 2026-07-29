import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "@/features/knowledge/lib/chunk";

describe("splitIntoChunks", () => {
  it("terminates when the final segment is shorter than the overlap", () => {
    const text = "a".repeat(2_750);

    const chunks = splitIntoChunks(text, 1_500, 200);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1_500);
    expect(chunks[1]).toHaveLength(1_450);
  });

  it("rejects overlap values that cannot advance the cursor", () => {
    expect(() => splitIntoChunks("content", 200, 200)).toThrow(
      "CHUNK_OVERLAP_INVALID",
    );
  });
});
