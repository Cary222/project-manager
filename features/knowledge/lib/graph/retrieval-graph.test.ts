import { describe, expect, it, vi } from "vitest";
import {
  extractQueryEntityTerms,
  searchGraphCandidates,
} from "./retrieval-graph";
import type { PrismaClient } from "@prisma/client";

describe("retrieval-graph", () => {
  describe("extractQueryEntityTerms", () => {
    it("extracts ticket numbers with both # and ticket_ prefix", () => {
      const terms = extractQueryEntityTerms("排查工单 #10208 的报错");
      expect(terms).toContain("#10208");
      expect(terms).toContain("ticket_10208");
    });

    it("returns empty for empty query", () => {
      expect(extractQueryEntityTerms("")).toEqual([]);
      expect(extractQueryEntityTerms("   ")).toEqual([]);
    });

    it("splits terms and includes full query", () => {
      const terms = extractQueryEntityTerms("Next.js 知识图谱");
      expect(terms).toContain("Next.js 知识图谱");
      expect(terms).toContain("Next.js");
      expect(terms).toContain("知识图谱");
    });
  });

  describe("searchGraphCandidates", () => {
    it("returns empty when query is blank", async () => {
      const mockDb = {} as PrismaClient;
      const results = await searchGraphCandidates(mockDb, { query: "" });
      expect(results).toEqual([]);
    });

    it("executes seed linking and CTE traversal", async () => {
      const mockQueryRaw = vi.fn();
      const mockDb = {
        $queryRaw: mockQueryRaw,
      } as unknown as PrismaClient;

      // 1. mock seed query
      mockQueryRaw.mockResolvedValueOnce([
        { id: "node_1", label: "Ticket #10208", type: "TICKET" },
      ]);

      // 2. mock CTE traversal
      mockQueryRaw.mockResolvedValueOnce([
        {
          chunk_id: "chunk_100",
          hop_depth: 1,
          hit_freq: 2,
          path_repr: "Ticket #10208 -[ASSIGNED_TO]-> 张工",
        },
      ]);

      // 3. mock SearchDocument fetching
      mockQueryRaw.mockResolvedValueOnce([
        {
          id: "chunk_100",
          sourceType: "TICKET",
          sourceId: "ticket_1",
          chunkIndex: 0,
          title: "工单标题",
          content: "工单正文内容",
          metadata: { ticketNo: 10208 },
          projectId: "proj_1",
          userId: "user_1",
          isPublic: null,
        },
      ]);

      const results = await searchGraphCandidates(mockDb, {
        query: "#10208",
        viewerUserId: "user_1",
      });

      expect(results).toHaveLength(1);
      expect(results[0].documentId).toBe("chunk_100");
      expect(results[0].hopDistance).toBe(1);
      expect(results[0].paths[0]).toContain("Ticket #10208");
    });
  });
});
