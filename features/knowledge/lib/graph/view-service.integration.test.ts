// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  graphQuerySchema,
  readGraphView,
  searchGraphView,
} from "./view-service";

// Explicit opt-in only. The database itself enforces read-only; no fixtures or DDL.
const enabled = process.env.GRAPH_READ_ONLY_TESTS === "1";
const db = enabled ? new PrismaClient() : null;
afterAll(async () => {
  await db?.$disconnect();
});

describe.skipIf(!enabled)("graph PostgreSQL read-only integration", () => {
  it("executes bounded, ACL-filtered queries against real schema without writes", async () => {
    await db!.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
        const viewer = await tx.user.findFirst({
          where: { role: "ROOT", bannedAt: null },
          select: { id: true, role: true },
        });
        expect(viewer).toBeTruthy();
        if (!viewer) return;
        const data = await readGraphView(
          tx,
          viewer,
          graphQuerySchema.parse({ depth: 2, limit: 100 }),
        );
        expect(data.nodes.length).toBeGreaterThan(0);
        expect(data.nodes.length).toBeLessThanOrEqual(100);
        expect(data.edges.length).toBeLessThanOrEqual(1000);
        const ids = new Set(data.nodes.map((n) => n.id));
        expect(
          data.edges.every((e) => ids.has(e.source) && ids.has(e.target)),
        ).toBe(true);
        const inaccessible = await readGraphView(
          tx,
          { id: "nonexistent-read-only-test-user", role: "USER" },
          graphQuerySchema.parse({}),
        );
        expect(inaccessible.nodes).toEqual([]);
        const matches = await searchGraphView(
          tx,
          { id: "nonexistent-read-only-test-user", role: "USER" },
          graphQuerySchema.parse({ q: "", limit: 50 }),
        );
        expect(
          matches.every((n) => n.type === "PKM_NOTE" || n.type === "DOCUMENT"),
        ).toBe(true);
        for (const node of matches.filter((n) => n.type === "PKM_NOTE")) {
          const source = await tx.knowledgeNode.findUniqueOrThrow({
            where: { id: node.id },
            select: { metadata: true },
          });
          const noteId = (source.metadata as { noteId: string }).noteId;
          const note = await tx.pkmNote.findUniqueOrThrow({
            where: { id: noteId },
            select: { isPublic: true },
          });
          expect(note.isPublic).toBe(true);
        }
      },
      { timeout: 20000, isolationLevel: "RepeatableRead" },
    );
  }, 25000);
});
