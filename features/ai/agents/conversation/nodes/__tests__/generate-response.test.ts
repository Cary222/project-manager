import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateResponseNode } from "../generate-response";
import { HumanMessage } from "@langchain/core/messages";
import type { AgentState } from "../../agent";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

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

const mockStreamChunks = ["你好", "，我是", "小星", "！"];

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn().mockImplementation(() => ({
      textStream: (async function* () {
        for (const chunk of mockStreamChunks) {
          yield chunk;
        }
      })(),
      text: Promise.resolve(mockStreamChunks.join("")),
    })),
  };
});

describe("generateResponseNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should stream tokens via onTextDelta when provided in config", async () => {
    const deltas: string[] = [];
    const onTextDelta = vi.fn((delta: string) => {
      deltas.push(delta);
    });
    const onGenerateStart = vi.fn();

    const state = {
      messages: [new HumanMessage("你好")],
      mode: "chat",
      userName: "张三",
      userId: "user-123",
      profile: null,
      waitingForConfirmation: false,
    } as unknown as AgentState;

    const config = {
      configurable: {
        onTextDelta,
        onGenerateStart,
      },
    };

    const result = await generateResponseNode(state, config as LangGraphRunnableConfig);

    expect(onGenerateStart).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledTimes(4);
    expect(deltas).toEqual(["你好", "，我是", "小星", "！"]);
    expect(result.response).toBe("你好，我是小星！");
  });

  it("should work correctly without config or onTextDelta", async () => {
    const state = {
      messages: [new HumanMessage("你好")],
      mode: "chat",
      userName: "张三",
      userId: "user-123",
      profile: null,
      waitingForConfirmation: false,
    } as unknown as AgentState;

    const result = await generateResponseNode(state);

    expect(result.response).toBe("你好，我是小星！");
  });

  it("should receive config and onTextDelta when executed inside StateGraph.stream", async () => {
    const { StateGraph, Annotation } = await import("@langchain/langgraph");
    const StateAnnotation = Annotation.Root({
      messages: Annotation<any[]>({
        value: (_c, u) => u,
        default: () => [],
      }),
      response: Annotation<string>({
        value: (_c, u) => u,
        default: () => "",
      }),
    });
    const graph = new StateGraph(StateAnnotation)
      .addNode("generate", generateResponseNode as any)
      .addEdge("__start__", "generate")
      .addEdge("generate", "__end__")
      .compile();

    const deltas: string[] = [];
    const onTextDelta = vi.fn((delta: string) => deltas.push(delta));
    const onGenerateStart = vi.fn();

    const stream = await graph.stream(
      { messages: [new HumanMessage("你好")] },
      { configurable: { onTextDelta, onGenerateStart } }
    );

    for await (const chunk of stream) {
      // drain stream
    }

    expect(onGenerateStart).toHaveBeenCalled();
    expect(onTextDelta).toHaveBeenCalledTimes(4);
    expect(deltas).toEqual(["你好", "，我是", "小星", "！"]);
  });
});
