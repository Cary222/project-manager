import { describe, expect, it } from "vitest";
import {
  serializeHandoffParams,
  deserializeHandoffParams,
  type ChatToWorkHandoffPayload,
} from "../handoff-contract";

describe("Chat to Work Handoff Contract", () => {
  it("serializes and deserializes handoff payload cleanly", () => {
    const payload: ChatToWorkHandoffPayload = {
      originalPrompt: "生成本周周报并包含工单 #10208 的进展",
      sourceConversationId: "conv-12345",
      workflowHint: "weekly_report",
      projectId: "proj-abc",
      ticketId: "ticket-10208",
    };

    const params = serializeHandoffParams(payload);
    expect(params.get("m")).toBe("work");
    expect(params.get("goal")).toBe(payload.originalPrompt);
    expect(params.get("c")).toBe("conv-12345");
    expect(params.get("route")).toBe("weekly_report");
    expect(params.get("projectId")).toBe("proj-abc");
    expect(params.get("ticketId")).toBe("ticket-10208");

    const restored = deserializeHandoffParams(params);
    expect(restored.originalPrompt).toBe(payload.originalPrompt);
    expect(restored.sourceConversationId).toBe(payload.sourceConversationId);
    expect(restored.workflowHint).toBe(payload.workflowHint);
    expect(restored.projectId).toBe(payload.projectId);
    expect(restored.ticketId).toBe(payload.ticketId);
  });
});
