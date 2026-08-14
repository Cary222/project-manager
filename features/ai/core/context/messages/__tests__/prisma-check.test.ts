import { describe, it, expect } from "vitest";
import { prisma } from "@/shared/db/client";

describe("prisma sanity", () => {
  it("prisma instance is defined", () => {
    expect(prisma).toBeDefined();
    console.log("typeof prisma:", typeof prisma);
    console.log("aiConversationRuntimeState:", typeof prisma?.aiConversationRuntimeState);
  });

  it("can find by conv id", async () => {
    const row = await prisma.aiConversationRuntimeState.findUnique({
      where: { conversationId: "cmsa6978z003990jbiicfqg0x" },
    });
    console.log("row:", row);
    expect(row === null || typeof row === "object").toBe(true);
  });
});
