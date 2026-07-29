import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";

loadEnvConfig(process.cwd());

type Candidate = { id: string; name: string; email: string };
type GraphInput = Record<string, unknown>;
type GraphUpdate = Record<string, Record<string, unknown>>;

const candidates: Candidate[] = [
  { id: "user-cary", name: "cary（刘屹鹏）", email: "cary@example.com" },
  { id: "user-liu", name: "刘屹鹏（user test）", email: "liu@example.com" },
];

function getConfirmedUserId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const filters = (input as { filters?: unknown }).filters;
  if (!filters || typeof filters !== "object") return undefined;
  const userId = (filters as { userId?: unknown }).userId;
  return typeof userId === "string" ? userId : undefined;
}

function mergeUpdates(
  input: GraphInput,
  updates: GraphUpdate[],
): Record<string, unknown> {
  const state: Record<string, unknown> = { ...input };
  for (const update of updates) {
    for (const nodeOutput of Object.values(update)) {
      for (const [key, value] of Object.entries(nodeOutput)) {
        if (key === "toolResults" && value && typeof value === "object") {
          state.toolResults = {
            ...((state.toolResults as Record<string, unknown> | undefined) ?? {}),
            ...value,
          };
          continue;
        }
        state[key] = value;
      }
    }
  }
  return state;
}

async function runGraph(
  graph: { stream: (input: GraphInput, options: { streamMode: "updates" }) => Promise<AsyncIterable<GraphUpdate>> },
  input: GraphInput,
) {
  const updates: GraphUpdate[] = [];
  const stream = await graph.stream(input, { streamMode: "updates" });
  for await (const update of stream) updates.push(update);
  return {
    nodeNames: updates.flatMap((update) => Object.keys(update)),
    state: mergeUpdates(input, updates),
  };
}

async function main() {
  const [{ agentGraph }, { searchStructured }] = await Promise.all([
    import("../features/ai/graph/agent"),
    import("../features/ai/tools/search-structured"),
  ]);

  const originalExecute = searchStructured.execute;
  let searchCalls = 0;
  Object.defineProperty(searchStructured, "execute", {
    configurable: true,
    writable: true,
    value: async (input: unknown) => {
      searchCalls += 1;
      const confirmedUserId = getConfirmedUserId(input);
      if (!confirmedUserId) {
        return {
          summary: "找到多个相关用户。",
          sources: [],
          attribution: {
            kind: "user_activity",
            targetUserName: "刘工",
            windowLabel: "最近 7 天",
            hasDirectEvidence: false,
            directEvidenceCount: 0,
            directNoteCount: 0,
            directTicketActionCount: 0,
            directCommentCount: 0,
            relatedTicketCount: 0,
            relatedCommitCount: 0,
            candidates,
          },
        };
      }
      return {
        summary: `用户 ${confirmedUserId} 最近的活动：已完成项目管理相关工作。`,
        sources: [],
      };
    },
  });

  try {
    const first = await runGraph(agentGraph, {
      messages: [new HumanMessage("刘工最近在做什么")],
      mode: "auto",
      userName: "测试用户",
      profile: null,
      clientCity: null,
    });

    assert.ok(first.nodeNames.includes("detectIntent"));
    assert.ok(first.nodeNames.includes("searchStructured"));
    assert.ok(first.nodeNames.includes("generateResponse"));
    assert.ok(!first.nodeNames.includes("humanConfirmation"));
    assert.equal((first.state.pendingConfirmation as { candidates: Candidate[] }).candidates.length, 2);
    assert.equal(first.state.waitingForConfirmation, true);
    assert.match(String(first.state.response), /请回复数字.*姓名确认/);
    process.stdout.write("场景 1 通过：首轮检测到 2 个候选并输出选择提示\n");

    const pendingConfirmation = first.state.pendingConfirmation;
    const second = await runGraph(agentGraph, {
      messages: [
        new HumanMessage("刘工最近在做什么"),
        new AIMessage(String(first.state.response)),
        new HumanMessage("2"),
      ],
      mode: "auto",
      userName: "测试用户",
      profile: null,
      clientCity: null,
      pendingConfirmation,
      waitingForConfirmation: true,
      toolResults: first.state.toolResults,
    });

    assert.deepEqual(second.nodeNames.slice(0, 3), ["detectIntent", "humanConfirmation", "searchStructured"]);
    assert.ok(second.nodeNames.includes("generateResponse"));
    assert.equal(second.state.waitingForConfirmation, false);
    assert.equal(second.state.pendingConfirmation, null);
    assert.equal(
      (second.state.toolResults as Record<string, unknown>).confirmedUserId,
      candidates[1].id,
    );
    assert.match(String(second.state.response), /user-liu/);
    process.stdout.write("场景 2 通过：数字选择进入确认节点并使用 confirmedUserId 查询\n");

    const invalid = await runGraph(agentGraph, {
      messages: [
        new HumanMessage("刘工最近在做什么"),
        new AIMessage(String(first.state.response)),
        new HumanMessage("3"),
      ],
      mode: "auto",
      userName: "测试用户",
      profile: null,
      clientCity: null,
      pendingConfirmation,
      waitingForConfirmation: true,
      toolResults: first.state.toolResults,
    });

    assert.deepEqual(invalid.nodeNames, ["detectIntent", "humanConfirmation", "generateResponse"]);
    assert.equal(invalid.state.waitingForConfirmation, true);
    assert.equal((invalid.state.pendingConfirmation as { candidates: Candidate[] }).candidates.length, 2);
    assert.match(String(invalid.state.response), /请回复数字.*姓名确认/);
    assert.equal(searchCalls, 2);
    process.stdout.write("场景 3 通过：无效选择保持等待并重新渲染提示\n");

    // ── 场景 4：用户输入 "0" 跳过确认 ──────────────────────────────────────────
    const skip = await runGraph(agentGraph, {
      messages: [
        new HumanMessage("刘工最近在做什么"),
        new AIMessage(String(first.state.response)),
        new HumanMessage("0"),
      ],
      mode: "auto",
      userName: "测试用户",
      profile: null,
      clientCity: null,
      pendingConfirmation,
      waitingForConfirmation: true,
      toolResults: first.state.toolResults,
      originalQuery: String(first.state.messages[0].content),
    });

    assert.deepEqual(skip.nodeNames.slice(0, 3), ["detectIntent", "humanConfirmation", "searchStructured"]);
    assert.ok(skip.nodeNames.includes("generateResponse"));
    assert.equal(skip.state.waitingForConfirmation, false);
    assert.equal(skip.state.pendingConfirmation, null);
    assert.equal(
      (skip.state.toolResults as Record<string, unknown>).confirmedUserId,
      undefined,
    );
    // 取消消息
    const skipMessages = (skip.state.messages as BaseMessage[]).filter(
      (m) => m instanceof AIMessage
    );
    assert.ok(
      skipMessages.some((m) => String(m.content).includes("好的，已取消本次确认")),
      `期望包含取消消息，实际消息：${skipMessages.map((m) => m.content)}`,
    );
    process.stdout.write("场景 4 通过：用户输入 0 跳过确认 → pendingConfirmation 清空 → confirmedUserId=undefined → 路由到 searchStructured\n");
  } finally {
    Object.defineProperty(searchStructured, "execute", {
      configurable: true,
      writable: true,
      value: originalExecute,
    });
  }
}

main().catch((error) => {
  console.error("human-in-loop 测试失败:", error);
  process.exitCode = 1;
});
