import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildRagPrompt, retrieveContext } from "./rag";
import type { SearchResponse } from "@/features/knowledge/lib/search-types";

const mockSearchDocuments = vi.fn();
vi.mock("@/features/knowledge/lib/search", () => ({
  searchDocuments: (...args: unknown[]) => mockSearchDocuments(...args),
}));

vi.mock("@/shared/db/client", () => ({
  prisma: {
    projectMeeting: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("RAG + GraphRAG pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts and exposes knowledgePaths from graph-augmented search results", async () => {
    const mockResponse: SearchResponse = {
      mode: "search",
      query: "工单排查",
      tookMs: 10,
      total: 1,
      results: [
        {
          id: "chunk_1",
          type: "ticket",
          title: "工单 #10208 报错修复",
          snippet: "修复了 Chat 模式下的附件崩溃问题",
          project: { id: "p1", name: "ProjectHub" },
          url: "/tickets/ticket_1",
          score: 0.9,
          keywordScore: 0.8,
          semanticScore: 0.7,
          metadata: { ticketNo: 10208, chunkIndex: 0, totalChunks: 1 },
          sources: ["keyword", "graph"],
          knowledgePaths: ["Ticket #10208 -[BELONGS_TO]-> ProjectHub"],
        },
      ],
      grouped: { ticket: [], commit: [], note: [], doc: [] },
    };

    mockSearchDocuments.mockResolvedValueOnce(mockResponse);

    const context = await retrieveContext("工单排查", { useGraph: true });

    expect(context.results).toHaveLength(1);
    expect(context.knowledgePaths).toBeDefined();
    expect(context.knowledgePaths).toContain(
      "Ticket #10208 -[BELONGS_TO]-> ProjectHub",
    );

    // 验证 buildRagPrompt 包含知识图谱路径
    const prompt = buildRagPrompt("工单排查", context);
    expect(prompt).toContain("实体关联拓扑路径（GraphRAG 辅助推理线索）");
    expect(prompt).toContain("Ticket #10208 -[BELONGS_TO]-> ProjectHub");
    expect(prompt).toContain("[1] 工单：工单 #10208 报错修复");
  });

  it("handles empty knowledge base cleanly", () => {
    const prompt = buildRagPrompt("测试查询", { results: [], contextText: "" });
    expect(prompt).toContain("知识库中没有找到相关信息");
  });
});
