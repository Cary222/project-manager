import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  searchKnowledgeNode,
  injectSearchKnowledgeContext,
} from "../search-knowledge";
import { retrieveContext } from "@/features/ai/search/rag";
import { extractSourceReferences } from "@/features/ai/search/rag";
import type { AgentState } from "../../agent";
import { HumanMessage } from "@langchain/core/messages";

const mockRetrieveContext = vi.fn();
vi.mock("@/features/ai/search/rag", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/ai/search/rag")>();
  return {
    ...actual,
    retrieveContext: (...args: unknown[]) => mockRetrieveContext(...args),
  };
});

describe("AIChat GraphRAG query execution pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes viewerRole and useGraph: true to retrieveContext during agent execution", async () => {
    // 模拟 AIChat 会话初始化：用户 ID = user_root, 角色 = ROOT
    injectSearchKnowledgeContext("user_root", "conv_123", "ROOT");

    mockRetrieveContext.mockResolvedValueOnce({
      results: [
        {
          id: "chunk_graph_1",
          type: "ticket",
          title: "工单 #10010 整理wifi相机云端环境",
          snippet: "环境整理完毕",
          project: { id: "p1", name: "wifi相机" },
          url: "/tickets/ticket_10010",
          score: 0.95,
          keywordScore: 0.8,
          semanticScore: 0.8,
          metadata: { ticketNo: 10010 },
          sources: ["keyword", "graph"],
          knowledgePaths: ["#10010 整理wifi相机云端环境 -[ASSIGNED_TO]-> wxc"],
        },
      ],
      contextText: "工单 #10010 整理wifi相机云端环境",
      knowledgePaths: ["#10010 整理wifi相机云端环境 -[ASSIGNED_TO]-> wxc"],
    });

    const state: AgentState = {
      messages: [new HumanMessage("请查一下 #10010 工单的进展和关联信息")],
      mode: "search",
      originalQuery: "#10010",
    } as unknown as AgentState;

    // 执行 LangGraph 的知识检索节点
    const nodeOutput = await searchKnowledgeNode(state);

    // 验证 retrieveContext 被正确调用，且显式开启了 useGraph: true 和正确的 viewerRole
    expect(mockRetrieveContext).toHaveBeenCalledWith(
      "#10010",
      expect.objectContaining({
        userId: "user_root",
        viewerRole: "ROOT",
        useGraph: true,
      }),
    );

    expect(nodeOutput.searchResults).toBeDefined();
    expect(nodeOutput.toolResults?.searchKnowledge).toBeDefined();

    // 验证源引用提取包含了图谱信息
    const toolResult = nodeOutput.toolResults?.searchKnowledge as {
      results: Parameters<typeof extractSourceReferences>[0];
    };
    const sources = extractSourceReferences(toolResult.results);
    expect(sources).toHaveLength(1);
    expect(sources[0].sources).toContain("graph");
    expect(sources[0].knowledgePaths).toContain(
      "#10010 整理wifi相机云端环境 -[ASSIGNED_TO]-> wxc",
    );
  });
});
