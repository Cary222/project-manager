import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { getWorkAgentGraph, initializeWorkAgent } from "@/features/ai/agents/work/graph";
import { getPiSubAgent } from "@/features/ai/agents/work/subagents/pi/subagent";
import type { SubAgentEvent } from "@/features/ai/agents/work/subagents/types";

const runSchema = z.object({
  input: z.string().min(1, "输入不能为空"),
});

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
  try {
    const session = await requireSession();
    const body = await request.json();
    const parsed = runSchema.parse(body);

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
    const stream = await graph.stream(initialState);

    // Create SSE stream
    const encoder = new TextEncoder();
    
    // 在外部创建 AbortController，以便在 cancel() 中访问
    const abortController = new AbortController();

    const stream_ = new ReadableStream({
      async start(controller) {
        // Helper to send SSE event
        const sendEvent = (type: string, payload: unknown) => {
          try {
            const data = JSON.stringify({ type, payload });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            // controller closed, ignore
          }
        };

        try {
          // 1. 发送 run_started 事件
          sendEvent("run_started", { runId });

          // 2. 流式处理 graph 事件
          for await (const chunk of stream) {
            // 检查是否已取消
            if (abortController.signal.aborted) {
              break;
            }

            // dispatch 阶段：获取 taskType
            if (chunk.dispatch) {
              const dispatchResult = chunk.dispatch;
              sendEvent("dispatch_result", {
                taskType: dispatchResult.taskType,
                workflowType: dispatchResult.workflowType,
              });

              // 如果是 coding 类任务，启动 Pi SubAgent 并发送 SSE 事件
              if (dispatchResult.taskType === "coding") {
                await handleCodingTask(
                  runId,
                  session.user.id,
                  parsed.input,
                  sendEvent,
                  abortController.signal
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
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: err.issues },
        { status: 400 }
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
  signal: AbortSignal
): Promise<void> {
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

    // 创建 SubAgentInput
    const subAgentInput = {
      prompt: userInput,
      workspace: process.cwd(),
      contextFiles: [],
    };

    // 启动 Pi session
    const handle = await piAgent.start(subAgentRun, subAgentInput);

    // 发送 Pi session 已启动事件
    sendEvent("pi_session_started", {
      piRunId: handle.runId,
      piSessionId: handle.sessionId,
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
      });
    }
  }
}

/**
 * 将 SubAgentEvent 映射为 SSE 事件类型
 */
function mapSubAgentEventToSSEType(event: SubAgentEvent): string {
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
