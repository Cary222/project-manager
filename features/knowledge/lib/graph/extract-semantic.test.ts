import { describe, expect, it, vi } from "vitest";
import { parseExtractionJson, persistExtractedGraph } from "./extract-semantic";
import type { PrismaClient } from "@prisma/client";

describe("extract-semantic", () => {
  describe("parseExtractionJson", () => {
    it("parses valid json in markdown codeblock", () => {
      const markdown = `
\`\`\`json
{
  "entities": [
    { "name": "Next.js", "type": "TECHNOLOGY", "description": "React 框架" },
    { "name": "GraphRAG", "type": "CONCEPT", "description": "图谱增强生成" }
  ],
  "relations": [
    { "source": "Next.js", "target": "GraphRAG", "relType": "SUPPORTS", "confidence": 0.9 }
  ]
}
\`\`\`
      `;

      const result = parseExtractionJson(markdown);
      expect(result.entities).toHaveLength(2);
      expect(result.entities[0].name).toBe("Next.js");
      expect(result.entities[0].type).toBe("TECHNOLOGY");
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].relType).toBe("SUPPORTS");
      expect(result.relations[0].confidence).toBe(0.9);
    });

    it("handles invalid json gracefully without throwing", () => {
      const invalid = "not a valid json string { broken: true";
      const result = parseExtractionJson(invalid);
      expect(result.entities).toEqual([]);
      expect(result.relations).toEqual([]);
    });
  });

  describe("persistExtractedGraph", () => {
    it("upserts entities and edges with provenance", async () => {
      const mockQueryRaw = vi.fn();
      const mockExecuteRaw = vi.fn();
      const mockDb = {
        $queryRaw: mockQueryRaw,
        $executeRaw: mockExecuteRaw,
      } as unknown as PrismaClient;

      // 模拟实体不存在，返回新创建的 ID
      mockQueryRaw
        .mockResolvedValueOnce([]) // existing check for e1
        .mockResolvedValueOnce([{ id: "node_e1" }]) // created e1
        .mockResolvedValueOnce([]) // existing check for e2
        .mockResolvedValueOnce([{ id: "node_e2" }]); // created e2

      mockExecuteRaw.mockResolvedValue(1);

      const result = await persistExtractedGraph(mockDb, {
        extraction: {
          entities: [
            { name: "Prisma", type: "TECHNOLOGY" },
            { name: "PostgreSQL", type: "TECHNOLOGY" },
          ],
          relations: [
            {
              source: "Prisma",
              target: "PostgreSQL",
              relType: "CONNECTS_TO",
              confidence: 0.95,
            },
          ],
        },
        sourceDocumentId: "doc_1",
        sourceChunkId: "chunk_1",
        projectId: "proj_1",
      });

      expect(result.nodeCount).toBe(2);
      expect(result.edgeCount).toBe(1);
      expect(mockExecuteRaw).toHaveBeenCalled();
    });
  });
});
