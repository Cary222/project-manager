import { describe, it, expect, vi, type Mock } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { routeAfterRetrieveEvidence } from "./edges/routing";
import {
  understandQuery,
  type QueryUnderstanding,
} from "@/features/ai/search/query-understanding";
import { agentGraph, type AgentState } from "./agent";
import { retrievePlannedContext } from "@/features/ai/search/planned-retrieval";

vi.mock("@/features/ai/search/planned-retrieval", () => ({
  retrievePlannedContext: vi.fn(),
}));

vi.mock("@/features/ai/llm/providers/init", () => ({
  ensureSystemProvider: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/ai/llm/model-routing", () => ({
  selectModel: vi.fn().mockReturnValue({
    providerId: "test-provider",
    modelName: "test-model",
  }),
}));

vi.mock("@/features/ai/llm/model-runtime-config", () => ({
  resolveModelRuntimeConfig: vi.fn().mockResolvedValue(null),
  buildReasoningProviderOptions: vi.fn().mockReturnValue(undefined),
}));

vi.mock("@/features/ai/llm/providers/registry", () => ({
  createModel: vi.fn().mockResolvedValue({}),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn().mockImplementation(() => ({
      textStream: (async function* () {
        yield "根据检索到的完整证据，相关工单与提交如下。";
      })(),
      text: Promise.resolve("根据检索到的完整证据，相关工单与提交如下。"),
    })),
  };
});

function createMockState(overrides: Partial<AgentState> = {}): AgentState {
  const plan = understandQuery("光污染设计涉及哪些工单和提交记录");
  return {
    messages: [],
    mode: "auto",
    userName: "test_user",
    userId: "u1",
    profile: null,
    clientCity: null,
    pendingHumanAction: null,
    waitingForConfirmation: false,
    originalQuery: "",
    resolvedEntities: null,
    toolResults: {},
    retrievalPlan: plan,
    lastMentionedUser: null,
    lastMentionedTicket: null,
    workflowMatch: null,
    modelContext: null,
    queryType: null,
    extractedUser: null,
    activityWindow: null,
    resolvedTimeWindow: null,
    searchResults: [],
    clarificationSuggestions: null,
    ragTrace: null,
    agenticStep: 0,
    response: "",
    ...overrides,
  };
}

describe("P10 Agentic RAG - Bounded Loop Orchestration (routeAfterRetrieveEvidence)", () => {
  it("routes directly to generateResponse on SUFFICIENT evidence (1 step)", () => {
    const state = createMockState({
      agenticStep: 1,
      toolResults: {
        retrieval: {
          evaluation: { status: "SUFFICIENT" },
          allowWeb: false,
        },
      },
    });

    const nextNode = routeAfterRetrieveEvidence(state);
    expect(nextNode).toBe("generateResponse");
  });

  it("routes directly to generateResponse on AMBIGUOUS evidence (1 step with post-retrieval suggestions)", () => {
    const state = createMockState({
      agenticStep: 1,
      toolResults: {
        retrieval: {
          evaluation: { status: "AMBIGUOUS" },
          allowWeb: false,
        },
      },
    });

    const nextNode = routeAfterRetrieveEvidence(state);
    expect(nextNode).toBe("generateResponse");
  });

  it("autonomously loops back to retrieveEvidence on WEAK evidence when subQueries exist (step 1 -> step 2)", () => {
    const plan = understandQuery("光污染设计涉及哪些工单和提交记录");
    expect(plan.subQueries?.length).toBeGreaterThanOrEqual(2);

    const state = createMockState({
      agenticStep: 1, // After step 1
      retrievalPlan: plan,
      toolResults: {
        retrieval: {
          evaluation: { status: "WEAK" },
          allowWeb: false,
        },
      },
    });

    const nextNode = routeAfterRetrieveEvidence(state);
    expect(nextNode).toBe("retrieveEvidence");
  });

  it("strictly bounds execution and terminates loop when maxAgenticSteps is reached (<= 3 total steps)", () => {
    const plan = understandQuery("光污染设计涉及哪些工单和提交记录");

    const state = createMockState({
      agenticStep: 3, // Reached step limit (3 steps max)
      retrievalPlan: plan,
      toolResults: {
        retrieval: {
          evaluation: { status: "WEAK" },
          allowWeb: false,
        },
      },
    });

    // Must not loop infinitely — strictly terminates to generateResponse
    const nextNode = routeAfterRetrieveEvidence(state);
    expect(nextNode).toBe("generateResponse");
  });

  it("routes to webSearch when external query is permitted and internal evidence is insufficient after retries", () => {
    const plan = understandQuery("今天北京天气怎么样");
    plan.scope = "WEB_ALLOWED";

    const state = createMockState({
      agenticStep: 3,
      retrievalPlan: plan,
      toolResults: {
        retrieval: {
          evaluation: { status: "INSUFFICIENT" },
          allowWeb: true,
        },
      },
    });

    const nextNode = routeAfterRetrieveEvidence(state);
    expect(nextNode).toBe("webSearch");
  });
});

describe("P10 Agentic RAG - End-to-End LangGraph Orchestration (agentGraph)", () => {
  it("traverses detectIntent -> modelSelect -> retrieveEvidence -> re-route loop -> generateResponse within <= 3 steps", async () => {
    const query = "光污染设计涉及哪些工单和代码提交";

    let retrievalCallCount = 0;
    const executedQueries: string[] = [];

    // Mock retrievePlannedContext with Step 1 (WEAK) -> Step 2 (SUFFICIENT)
    (retrievePlannedContext as unknown as Mock).mockImplementation(
      async (
        executedQuery: string,
        _userId: string,
        plan: QueryUnderstanding,
      ) => {
        retrievalCallCount++;
        executedQueries.push(executedQuery);

        if (retrievalCallCount === 1) {
          // Step 1: Initial query returns WEAK evidence
          return {
            retrieval: {
              plan: {
                ...plan,
                subQueries: [
                  "光污染 关联工单 任务进度 缺陷排查",
                  "光污染 代码提交 commit 变更历史",
                ],
              },
              route: "MIX",
              evidence: [
                {
                  id: "note_1",
                  type: "note",
                  title: "光污染设计需求文档",
                  content: "系统设计方案详述",
                  url: "/pkm/notes/note_1",
                  channel: "hybrid",
                },
              ],
              attempts: [
                { round: 0, retriever: "hybrid", status: "ok", count: 1 },
              ],
              enough: false,
              missingTypes: ["ticket", "commit"],
              rewritten: false,
              allowWeb: false,
              evaluation: {
                status: "WEAK",
                score: 0.5,
                reason: "缺少显式要求的工单与提交记录",
                suggestions: [
                  {
                    id: "s1",
                    label: "查看项目「光污染计」",
                    query: "项目 光污染计 详情",
                  },
                ],
                coverage: {
                  requestedTypes: ["note", "ticket", "commit"],
                  coveredTypes: ["note"],
                  missingTypes: ["ticket", "commit"],
                },
              },
            },
            contextText: "[1] 笔记：光污染设计需求文档\n系统设计方案详述",
            knowledgePaths: [],
            results: [],
            ragTrace: null,
          };
        }

        // Step 2: Autonomous retry with orthogonal sub-query brings in missing evidence (SUFFICIENT)
        return {
          retrieval: {
            plan,
            route: "MIX",
            evidence: [
              {
                id: "note_1",
                type: "note",
                title: "光污染设计需求文档",
                content: "系统设计方案详述",
                url: "/pkm/notes/note_1",
                channel: "hybrid",
              },
              {
                id: "ticket_1",
                type: "ticket",
                title: "#10018 光污染传感器校准",
                content: "校准光敏元件采集数据",
                url: "/tickets/ticket_1",
                channel: "structured",
              },
            ],
            attempts: [
              { round: 0, retriever: "structured", status: "ok", count: 2 },
            ],
            enough: true,
            missingTypes: [],
            rewritten: false,
            allowWeb: false,
            evaluation: {
              status: "SUFFICIENT",
              score: 0.9,
              reason: "已覆盖所需工单与文档",
              suggestions: [
                {
                  id: "s1",
                  label: "查看项目「光污染计」",
                  query: "项目 光污染计 详情",
                },
              ],
              coverage: {
                requestedTypes: ["note", "ticket", "commit"],
                coveredTypes: ["note", "ticket"],
                missingTypes: [],
              },
            },
          },
          contextText:
            "[1] 笔记：光污染设计需求文档\n[2] 工单：#10018 光污染传感器校准",
          knowledgePaths: ["#10018 -[BELONGS_TO]-> 光污染计"],
          results: [],
          ragTrace: null,
        };
      },
    );

    const initialState = {
      messages: [new HumanMessage(query)],
      mode: "auto" as const,
      userName: "张工程师",
      userId: "user_test_e2e",
      waitingForConfirmation: false,
      pendingHumanAction: null,
      resolvedEntities: null,
      toolResults: {},
      originalQuery: query,
    };

    const stream = await agentGraph.stream(initialState, {
      streamMode: "updates",
    });
    const executedNodeSequence: string[] = [];

    for await (const chunk of stream) {
      for (const nodeName of Object.keys(chunk)) {
        executedNodeSequence.push(nodeName);
      }
    }

    // Assert: Full graph traversal sequence
    expect(executedNodeSequence).toContain("detectIntent");
    expect(executedNodeSequence).toContain("modelSelect");
    expect(executedNodeSequence).toContain("retrieveEvidence");
    expect(executedNodeSequence).toContain("generateResponse");

    // Assert: Autonomous loop occurred (retrieveEvidence executed twice before generateResponse)
    const retrieveCount = executedNodeSequence.filter(
      (n) => n === "retrieveEvidence",
    ).length;
    expect(retrieveCount).toBe(2);

    // Assert: Total retrieval steps strictly bounded <= 3
    expect(retrieveCount).toBeLessThanOrEqual(3);

    // Assert: Second retrieval step was called with the orthogonal subquery!
    expect(executedQueries.length).toBe(2);
    expect(executedQueries[0]).toBe(query);
    expect(executedQueries[1]).toContain("光污染");
    expect(executedQueries[1]).toContain("关联工单");

    // Assert: Terminal node was generateResponse
    expect(executedNodeSequence[executedNodeSequence.length - 1]).toBe(
      "generateResponse",
    );
  });
});
