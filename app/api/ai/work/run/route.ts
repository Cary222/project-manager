import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import {
  getWorkAgentGraph,
  initializeWorkAgent,
} from "@/features/ai/agents/work/graph";
import { getPiSubAgent } from "@/features/ai/agents/work/subagents/pi/subagent";
import type { SubAgentEvent } from "@/features/ai/agents/work/subagents/types";
import { createPiSessionOwnership } from "@/features/ai/pi-integration/pi-session-ownership";

const runSchema = z.object({
  input: z.string().min(1, "输入不能为空"),
  model: z.string().optional(),
  command: z.enum(["goal", "plan", "audit", "reach", "websearch"]).optional(),
});

type CodingCommand = z.infer<typeof runSchema>["command"];

function buildCodingCommandPrompt(
  command: CodingCommand,
  goal: string,
): string {
  const normalizedGoal = goal.trim();
  const prefixes: Record<NonNullable<CodingCommand>, string> = {
    goal: "/goal",
    plan: "/plan",
    audit: "/audit",
    reach: "/reach",
    websearch: "/websearch",
  };
  return `${prefixes[command ?? "goal"]} ${normalizedGoal}`;
}

/**
 * POST /api/ai/work/run
 *
 * 启动 Work Agent 执行任务（自然语言输入）。
 *
 * Phase 2: 返回 SSE streaming（支持实时事件流）
 * - workflow 类任务：同步返回结果
 * - coding 类任务：SSE 实时推送 Pi 事件
 */
export async function POST(request: NextRequest) {
  console.log("[WorkAgent API] Request received");
  try {
    const session = await requireSession();
    console.log("[WorkAgent API] Session validated:", session.user.id);
    const body = await request.json();
    console.log("[WorkAgent API] Body parsed:", {
      input: body.input?.substring(0, 50),
    });
    const parsed = runSchema.parse(body);
    console.log("[WorkAgent API] Schema validated");

    // Initialize Work Agent
    initializeWorkAgent();

    // Get compiled graph
    const graph = getWorkAgentGraph();

    // Generate run ID
    const runId = `work-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Prepare initial state
    const initialState = {
      runId,
      userId: session.user.id,
      userName: session.user.name ?? "Unknown",
      sessionId: runId,
      userInput: parsed.input,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Phase 2: 使用 graph.stream() 返回 SSE
    console.log("[WorkAgent API] Creating graph stream");
    const stream = await graph.stream(initialState);
    console.log("[WorkAgent API] Graph stream created");

    // Create SSE stream
    const encoder = new TextEncoder();

    // 在外部创建 AbortController，以便在 cancel() 中访问
    const abortController = new AbortController();

    const stream_ = new ReadableStream({
      async start(controller) {
        console.log("[WorkAgent API] ReadableStream started");
        // Helper to send SSE event
        const sendEvent = (type: string, payload: unknown) => {
          try {
            const data = JSON.stringify({ type, payload });
            console.log("[WorkAgent API] Sending SSE event:", type);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch (err) {
            console.error("[WorkAgent API] Failed to send event:", err);
            // controller closed, ignore
          }
        };

        try {
          // 1. 发送 run_started 事件
          console.log("[WorkAgent API] Sending run_started");
          sendEvent("run_started", { runId });

          // 2. 流式处理 graph 事件
          console.log("[WorkAgent API] Starting to iterate graph stream");
          for await (const chunk of stream) {
            console.log("[WorkAgent API] Received chunk:", Object.keys(chunk));
            // 检查是否已取消
            if (abortController.signal.aborted) {
              break;
            }

            // dispatch 阶段：获取 taskType
            if (chunk.dispatch) {
              const dispatchResult = chunk.dispatch;
              console.log(
                "[WorkAgent API] Dispatch result:",
                JSON.stringify(dispatchResult, null, 2),
              );
              sendEvent("dispatch_result", {
                taskType: dispatchResult.taskType,
                workflowType: dispatchResult.workflowType,
              });

              // 如果是 coding 类任务，启动 Pi SubAgent 并发送 SSE 事件
              console.log(
                "[WorkAgent API] Checking taskType:",
                dispatchResult.taskType,
                '=== "coding"?',
                dispatchResult.taskType === "coding",
              );
              if (dispatchResult.taskType === "coding") {
                console.log("[WorkAgent API] Starting handleCodingTask");
                await handleCodingTask(
                  runId,
                  session.user.id,
                  parsed.input,
                  sendEvent,
                  abortController.signal,
                  parsed.model,
                  parsed.command,
                );
                console.log("[WorkAgent API] handleCodingTask completed");
              } else {
                console.log(
                  '[WorkAgent API] Task type is not "coding", skipping Pi SDK execution',
                );
              }
            }

            // workflow 执行阶段
            if (chunk.executeWorkflow) {
              sendEvent("workflow_progress", chunk.executeWorkflow);
            }

            // 完成状态
            if (chunk.finish) {
              sendEvent("state_update", chunk.finish);
            }
          }

          // 3. 发送 run_completed 事件
          if (!abortController.signal.aborted) {
            sendEvent("run_completed", { runId });
          }
        } catch (err) {
          if (err instanceof Error && err.name !== "AbortError") {
            sendEvent("error", {
              message: err.message,
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        // 客户端取消时，触发 AbortController
        abortController.abort();
      },
    });

    return new Response(stream_, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: err.issues },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

/**
 * 处理 coding 类任务：启动 Pi SubAgent 并发送 SSE 事件
 */
async function handleCodingTask(
  runId: string,
  userId: string,
  userInput: string,
  sendEvent: (type: string, payload: unknown) => void,
  signal: AbortSignal,
  requestedModel?: string,
  command: "goal" | "plan" | "audit" | "reach" | "websearch" = "goal",
): Promise<void> {
  let piSessionId: string | undefined;
  try {
    const piAgent = getPiSubAgent();

    // 创建 SubAgentRun
    const subAgentRun = {
      runId: `pi-${runId}`,
      agentType: "pi" as const,
      workspaceId: userId,
      sessionId: "",
      status: "pending" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 解析请求的模型参数
    let provider: string | undefined;
    let modelName: string | undefined;
    if (requestedModel) {
      if (requestedModel.includes(":")) {
        const [p, ...m] = requestedModel.split(":");
        provider = p;
        modelName = m.join(":");
      } else {
        provider = requestedModel;
      }
    }

    // 创建 SubAgentInput
    const subAgentInput = {
      prompt: buildCodingCommandPrompt(command, userInput),
      workspace: process.cwd(),
      contextFiles: [],
      userId,
      provider,
      model:
        modelName && provider
          ? {
              provider,
              name: modelName,
            }
          : undefined,
    };

    // 启动 Pi session
    const handle = await piAgent.start(subAgentRun, subAgentInput);

    // 发送 Pi session 已启动事件
    piSessionId = handle.sessionId;
    await createPiSessionOwnership({
      piSessionId,
      userId,
      source: "work_coding",
    });
    sendEvent("pi_session_started", {
      piRunId: handle.runId,
      piSessionId,
      command,
      workspaceUrl: `/ai-workspace?session=${encodeURIComponent(piSessionId)}`,
    });

    // 流式推送 Pi 事件
    for await (const event of handle.events) {
      // 检查是否已取消
      if (signal.aborted) {
        // 尝试取消 Pi session
        await piAgent.cancel(handle.runId).catch(() => {});
        break;
      }

      const eventType = mapSubAgentEventToSSEType(event);
      sendEvent(eventType, event);

      // 如果是 run_completed，退出循环
      if (event.type === "run_completed") {
        break;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name !== "AbortError") {
      sendEvent("pi_error", {
        message: err.message,
        piSessionId,
        command,
      });
    }
  }
}

/**
 * 将 SubAgentEvent 映射为 SSE 事件类型
 * Pi SDK 事件结构: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '字', content: '完整文本' } }
 */
function mapSubAgentEventToSSEType(
  event: SubAgentEvent | { type: string; [key: string]: unknown },
): string {
  // 特殊处理 Pi SDK 的 message_update 事件（包含 assistantMessageEvent）
  if (event.type === "message_update") {
    const assistantEvent = event.assistantMessageEvent as
      | { type?: string }
      | undefined;
    if (
      assistantEvent?.type === "text_delta" ||
      assistantEvent?.type === "text_end"
    ) {
      return "pi_assistant_message";
    }
    if (assistantEvent?.type === "tool_call") {
      return "pi_tool_call";
    }
    // 其他类型的 message_update 忽略
    return "pi_ignore";
  }

  switch (event.type) {
    case "run_started":
      return "pi_run_started";
    case "assistant_message":
      return "pi_assistant_message";
    case "tool_call":
      return "pi_tool_call";
    case "tool_result":
      return "pi_tool_result";
    case "tool_error":
      return "pi_tool_error";
    case "approval_required":
      return "pi_approval_required";
    case "progress":
      return "pi_progress";
    case "error":
      return "pi_error";
    case "run_completed":
      return "pi_run_completed";
    default:
      return "pi_unknown";
  }
}
