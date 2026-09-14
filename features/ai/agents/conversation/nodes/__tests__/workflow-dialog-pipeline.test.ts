import { describe, it, expect, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { detectIntent } from "../detect-intent";
import {
  routeAfterModelSelect,
  routeAfterGenerateResponse,
} from "../../edges/routing";
import { generateResponseNode } from "../generate-response";
import type { AgentState } from "../../agent";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn().mockImplementation(() => ({
      textStream: (async function* () {
        yield "你可以通过周报工作流生成本周周报。";
      })(),
      text: Promise.resolve("你可以通过周报工作流生成本周周报。"),
    })),
  };
});
describe("Workflow Intent in Chat: Non-intrusive Handoff at Response Ending", () => {
  it("when user says '我要提交周报', Chat does NOT get interrupted, answers naturally, and appends Work handoff action at response ending", async () => {
    // 1. Initial state with user message
    const initialState = {
      messages: [new HumanMessage("我要提交周报")],
      mode: "auto",
    } as unknown as AgentState;

    // 2. detectIntent should recognize weekly_report workflow without interrupting the graph
    const intentPatch = await detectIntent(initialState);
    expect(intentPatch.workflowMatch).toBeDefined();
    expect(intentPatch.workflowMatch?.type).toBe("weekly_report");
    // Crucial: Chat does NOT stop in the understanding stage!
    expect(intentPatch.waitingForConfirmation).toBeFalsy();

    const stateAfterIntent: AgentState = {
      ...initialState,
      ...intentPatch,
    } as AgentState;

    // 3. routeAfterModelSelect routes to generateResponse normally
    const nextNode = routeAfterModelSelect(stateAfterIntent);
    expect([
      "generateResponse",
      "retrieveEvidence",
      "searchStructured",
    ]).toContain(nextNode);

    // 4. generateResponseNode MUST generate a response and append the Work handoff suggested action!
    const responsePatch = await generateResponseNode(stateAfterIntent);
    expect(responsePatch.response).toBeDefined();
    expect(responsePatch.suggestedActions).toBeDefined();
    expect(responsePatch.suggestedActions?.length).toBeGreaterThan(0);

    const workAction = responsePatch.suggestedActions?.find(
      (a) => a.target === "work",
    );
    expect(workAction).toBeDefined();
    expect(workAction?.workflowHint).toBe("weekly_report");
    expect(workAction?.label).toContain("周报");

    const stateAfterResponse: AgentState = {
      ...stateAfterIntent,
      ...responsePatch,
    } as AgentState;

    // 5. routeAfterGenerateResponse MUST return __end__
    const finalEdge = routeAfterGenerateResponse(stateAfterResponse);
    expect(finalEdge).toBe("__end__");
  });

  it("when user says '帮我汇总项目进展大盘', Chat provides response and suggests project_progress work action at the end", async () => {
    const initialState = {
      messages: [new HumanMessage("帮我汇总项目进展大盘")],
      mode: "auto",
    } as unknown as AgentState;

    const intentPatch = await detectIntent(initialState);
    expect(intentPatch.workflowMatch).toBeDefined();
    expect(intentPatch.workflowMatch?.type).toBe("project_progress");

    const stateAfterIntent: AgentState = {
      ...initialState,
      ...intentPatch,
    } as AgentState;

    const responsePatch = await generateResponseNode(stateAfterIntent);
    expect(responsePatch.suggestedActions).toBeDefined();
    const workAction = responsePatch.suggestedActions?.find(
      (a) => a.workflowHint === "project_progress",
    );
    expect(workAction).toBeDefined();
    expect(workAction?.target).toBe("work");
  });
});
