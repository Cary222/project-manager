import { callAgnes } from "@/features/ai/llm/summarizer";
/**
 * POST /api/ai/work/run —— Work Agent 的唯一入口与持久化编排者。
 *
 * 修掉的缺陷：旧实现在 SSE 循环里裸调 `prisma.workflowRun.create`，
 * 把未校验的 `WorkStep[]`（含 unknown 字段）直接塞进 metadata JSON 列，
 * 类型不合法；而且 planning 任务的"计划"从未经过 critic 校验，
 * 前端展示的还是被删掉的旧 routeWorkGoal 正则路由结果。
 *
 * 现在的顺序（C4 的核心：先持久化成功，再通知 UI）：
 *   1. 创建 run（幂等）            → 落库
 *   2. 服务端 Decision LLM 决策     → 落库 + SSE 展示理由（C1/C2）
 *   3. clarify  → 停下等用户补充，不发任何"已规划"的假信号
 *   4. planner  → critic 校验 → 计划版本落库 → SSE 请求计划审批（C3）
 *   5. workflow → 交给既有可靠模板 runtime（周报等不变）
 *   6. coding   → 能力分派到 Pi session（关键词判断，非业务路由）
 *
 * 执行不在这里发生：审批走 /api/ai/work/approve，由它真正启动执行。
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { isCodingTask } from "@/features/ai/agents/work/graph";
import { getPiSubAgent } from "@/features/ai/agents/work/subagents/pi/subagent";
import type { SubAgentEvent } from "@/features/ai/agents/work/subagents/types";
import { createPiSessionOwnership } from "@/features/ai/pi-integration/pi-session-ownership";
import {
  createWorkRun,
  mutateWorkRun,
  projectRun,
  loadWorkRun,
} from "@/features/ai/agents/work/runtime/work-run-store";
import {
  decideWorkStrategy,
  describeDecision,
} from "@/features/ai/agents/work/router/decision";
import { planForRun } from "@/features/ai/agents/work/planner/plan-for-run";
import {
  attachDecisionToRun,
  resolveTemplateType,
  startWorkflowByType,
} from "@/features/ai/agents/work/workflows/start";
import { prisma } from "@/shared/db/client";

const runSchema = z.object({
  input: z.string().min(1, "输入不能为空"),
  model: z.string().optional(),
  command: z.enum(["goal", "plan", "audit", "reach", "websearch"]).optional(),
  /**
   * 用户在界面上**显式选定**的流程。这是显式指令，不是正则推断 ——
   * 服务端直接采信并跳过 LLM 理解（但仍过白名单校验）。
   * "auto" 或不传 = 交给服务端 Decision 决定。
   */
  preferredWorkflow: z
    .enum([
      "auto",
      "weekly_report",
      "project_progress",
      "meeting_minutes",
      "planning",
    ])
    .optional(),
  /** 关联或继续的对话 ID（未传则自动创建 category="WORK" 的对话记录） */
  conversationId: z.string().optional(),
});

type CodingCommand = z.infer<typeof runSchema>["command"];

function buildCodingCommandPrompt(
  command: CodingCommand,
  goal: string,
): string {
  const prefixes: Record<NonNullable<CodingCommand>, string> = {
    goal: "/goal",
    plan: "/plan",
    audit: "/audit",
    reach: "/reach",
    websearch: "/websearch",
  };
  return `${prefixes[command ?? "goal"]} ${goal.trim()}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const parsed = runSchema.parse(body);

    const userId = session.user.id;
    const isRoot = session.user.role === "ROOT";
    const runId = `work-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (type: string, payload: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`),
            );
          } catch {
            // controller 已关闭，忽略
          }
        };

        try {
          // ── 确保关联 category="WORK" 的 AiConversation 对话记录 ──
          let effectiveConvId = parsed.conversationId;
          if (effectiveConvId) {
            const existingConv = await prisma.aiConversation.findUnique({
              where: { id: effectiveConvId },
              select: { id: true, userId: true },
            });
            if (existingConv && existingConv.userId === userId) {
              await prisma.aiChatMessage.create({
                data: {
                  conversationId: effectiveConvId,
                  role: "user",
                  content: parsed.input,
                },
              });
              await prisma.aiConversation.update({
                where: { id: effectiveConvId },
                data: {
                  category: "WORK",
                  lastMessageAt: new Date(),
                  messageCount: { increment: 1 },
                },
              });
            } else {
              effectiveConvId = undefined;
            }
          }

          if (!effectiveConvId) {
            const convTitle = parsed.input.slice(0, 30);
            const newConv = await prisma.aiConversation.create({
              data: {
                userId,
                title: convTitle,
                category: "WORK",
                messageCount: 1,
                lastMessageAt: new Date(),
                messages: {
                  create: {
                    role: "user",
                    content: parsed.input,
                  },
                },
              },
            });
            effectiveConvId = newConv.id;
          }

          sendEvent("run_started", { runId, conversationId: effectiveConvId });
          sendEvent("conversation_linked", { conversationId: effectiveConvId, runId });

          // ── 0. Capability Pre-check: Coding 快速分流（架构图 Step 1）
          // 纯代码/修复动作分派至 Pi session，避免进入业务流程拆解
          if (isCodingTask(parsed.input)) {
            sendEvent("dispatch_result", {
              mode: "coding",
              taskType: "coding",
              reason: "识别为代码变更类任务，分派到 Pi coding session",
            });
            await handleCodingTask(
              runId,
              userId,
              parsed.input,
              sendEvent,
              abortController.signal,
              parsed.model,
              parsed.command,
            );
            sendEvent("run_completed", { runId });
            return;
          }

          // ── 1. 先落库（幂等）。失败就直接报错，不假装成功。
          await createWorkRun({
            runId,
            userId,
            title: "（决策中）",
            userInput: parsed.input,
            status: "planning",
            workflowType: "planning",
            conversationId: effectiveConvId,
          });

          // ── 2. 服务端决策
          const { decision, dataScope, degraded } = await decideWorkStrategy(
            parsed.input,
            {
              userId,
              // 显式选择优先于一切推断 —— 但服务端仍会校验它是否在白名单内。
              forcedWorkflow:
                parsed.preferredWorkflow && parsed.preferredWorkflow !== "auto"
                  ? parsed.preferredWorkflow
                  : undefined,
            },
          );

          await mutateWorkRun(
            runId,
            userId,
            isRoot,
            (meta) => {
              meta.decision = {
                intent: decision.intent,
                reason: decision.reason,
                entities: decision.entities as Record<string, unknown>,
                mode: decision.mode,
                requestedWorkflow: decision.requestedWorkflow,
                missingInfo: decision.missingInfo,
                clarification: decision.clarification,
                createdAt: Date.now(),
              };
              meta.dataScope = {
                mode: dataScope.mode,
                projectIds: dataScope.projectIds,
                truncated: dataScope.truncated,
              };
              if (decision.mode !== "clarify") {
                meta.title = decision.intent.slice(0, 40);
              }
            },
            {
              status:
                decision.mode === "clarify"
                  ? "waiting_clarification"
                  : "planning",
              event: {
                event: "decision_made",
                payload: { mode: decision.mode },
              },
            },
          );

          // 决策理由必须给用户看（可解释性），不能只写日志
          sendEvent("decision", {
            runId,
            mode: decision.mode,
            intent: decision.intent,
            reason: decision.reason,
            summary: describeDecision(decision),
            unsupportedConcepts: decision.unsupportedConcepts,
            missingInfo: decision.missingInfo,
            confidence: decision.confidence,
            dataScope: {
              mode: dataScope.mode,
              projectCount:
                dataScope.mode === "all_projects"
                  ? -1
                  : dataScope.projectIds.length,
              truncated: dataScope.truncated,
            },
            degraded: degraded ?? null,
          });

          // ── 3. 澄清：停下来问人，不发任何"已规划"的假信号
          if (decision.mode === "clarify") {
            sendEvent("clarification_required", {
              runId,
              clarification: decision.clarification,
              missingInfo: decision.missingInfo,
              unsupportedConcepts: decision.unsupportedConcepts,
            });
            sendEvent("state_update", {
              status: "waiting_clarification",
              run: projectRun(await loadWorkRun(runId, userId, isRoot)),
            });
            sendEvent("run_completed", { runId });
            return;
          }

          // ── 3.5 direct 模式（闲聊、问答、简单问候）：直接回复，绝不走人工审批！
          if (decision.mode === "direct") {
            const startDirectAt = Date.now();
            const answerRes = await callAgnes(
              [
                {
                  role: "system",
                  content:
                    "你是 ProjectHub 智能工作台助手。简短友好地回答用户。如果用户是打招呼或询问功能，介绍你可以进行：项目/工单/工单状态历史查询、归因分析复盘、周报生成与项目进展汇总，并引导用户提出具体目标。",
                },
                { role: "user", content: parsed.input },
              ],
              { userId },
            );
            const finishDirectAt = Date.now();
            const replyText = answerRes.content.trim();

            await mutateWorkRun(
              runId,
              userId,
              isRoot,
              (meta) => {
                meta.title = decision.intent || "直接回答";
                meta.summary = replyText;
                meta.stepResults = {
                  direct: {
                    stepId: "direct",
                    planVersion: 1,
                    status: "done",
                    startedAt: startDirectAt,
                    finishedAt: finishDirectAt,
                    result: { content: replyText },
                    attempts: 1,
                  },
                };
                meta.plans = {
                  "1": {
                    version: 1,
                    title: decision.intent || "直接回答",
                    goal: parsed.input,
                    status: "completed",
                    createdAt: Date.now(),
                    createdBy: userId,
                    validation: { ok: true, errors: [] },
                    origin: { kind: "initial" },
                    steps: [
                      {
                        id: "direct",
                        action: "直接回答",
                        description: "直接解答用户问答，无需人工审批",
                        tool: "generate_text",
                        args: { instruction: parsed.input },
                        dependsOn: [],
                        requiresActionApproval: false,
                      },
                    ],
                  },
                };
              },
              {
                status: "done",
                event: {
                  event: "direct_answered",
                  payload: { reply: replyText.slice(0, 100) },
                },
              },
            );

            if (effectiveConvId) {
              try {
                await prisma.aiChatMessage.create({
                  data: {
                    conversationId: effectiveConvId,
                    role: "assistant",
                    content: replyText,
                    executionStatus: "COMPLETED",
                  },
                });
                await prisma.aiConversation.update({
                  where: { id: effectiveConvId },
                  data: {
                    lastMessageAt: new Date(),
                    messageCount: { increment: 1 },
                    title: decision.intent || replyText.slice(0, 30),
                  },
                });
              } catch (e) {
                console.error("[route] sync direct reply to conversation failed:", e);
              }
            }

            const directRun = await loadWorkRun(runId, userId, isRoot);

            sendEvent("dispatch_result", {
              mode: "direct",
              taskType: "direct",
              summary: replyText,
            });
            sendEvent("state_update", {
              status: "done",
              run: projectRun(directRun),
            });
            sendEvent("run_completed", { runId });
            return;
          }

          // ── 4. 固定模板：由既有的可靠 runtime 真正启动（周报/项目进展逻辑完全不变）
          if (decision.mode === "workflow" && decision.requestedWorkflow) {
            // 注册表 type（project_progress）与启动接口 type（project-progress）不一致，
            // 必须显式转换；转不出来说明该模板没有异步启动入口。
            const templateType = resolveTemplateType(
              decision.requestedWorkflow,
            );

            // meeting_minutes 走的是面板内录音上传流程，没有异步启动入口。
            // 这里只把决策结果告诉前端（由服务端决定，不再用正则），不假装已启动。
            if (decision.requestedWorkflow === "meeting_minutes") {
              sendEvent("dispatch_result", {
                runId,
                mode: "workflow",
                taskType: "meeting_minutes",
                summary: "需要上传会议录音后才能生成纪要",
              });
              sendEvent("run_completed", { runId });
              return;
            }

            if (templateType) {
              // 模板 runtime（startWorkflowManually）自己会创建 WorkflowRun 行。
              // 这条占位 run 只为满足"先持久化再通知"而建，此处移交生命周期给模板，
              // 删掉它以免同一次请求出现两条 run。
              await prisma.workflowRun.deleteMany({
                where: { id: runId, userId },
              });

              const started = await startWorkflowByType({
                userId,
                userName: session.user.name ?? undefined,
                workflowType: templateType,
                conversationId: effectiveConvId,
              });
              const templateRunId = started.skipped
                ? (started.existingRunId ?? started.runId)
                : started.runId;

              // 决策理由写进模板 run 的 metadata（外科式合并，不动模板自己的字段）
              await attachDecisionToRun(templateRunId, {
                mode: decision.mode,
                intent: decision.intent,
                reason: decision.reason,
                confidence: decision.confidence,
                unsupportedConcepts: decision.unsupportedConcepts,
              });

              sendEvent("dispatch_result", {
                runId: templateRunId,
                mode: "workflow",
                taskType: "workflow",
                workflowType: templateType,
                skipped: started.skipped,
                summary: started.skipped
                  ? "已有同类任务在运行，已复用现有任务"
                  : `已按决策启动固定工作流：${templateType}`,
              });
              sendEvent("run_completed", { runId: templateRunId });
              return;
            }
          }

          // ── 5. 动态规划：critic 校验后才落库
          const planned = await planForRun({
            runId,
            userId,
            isRoot,
            userInput: parsed.input,
            entities: decision.entities,
            dataScope,
            origin: "initial",
          });

          if (!planned.ok) {
            await mutateWorkRun(runId, userId, isRoot, () => {}, {
              status: "error",
              allowedStatuses: ["planning", "waiting_plan_approval"],
              event: {
                event: "plan_generation_failed",
                payload: { error: planned.error },
              },
            });
            sendEvent("error", {
              message: `计划生成失败：${planned.error}`,
              errors: planned.errors,
            });
            sendEvent("run_completed", { runId });
            return;
          }

          const fresh = await loadWorkRun(runId, userId, isRoot);

          sendEvent("dispatch_result", {
            mode: decision.mode,
            taskType: "planning",
            summary: planned.plan.title,
            steps: planned.plan.steps,
            warnings: planned.warnings,
            attempts: planned.attempts,
          });
          sendEvent("plan_approval_required", {
            runId,
            approvalId: `plan_${runId}_v${planned.plan.version}`,
            planVersion: planned.plan.version,
            title: planned.plan.title,
            goal: planned.plan.goal,
            steps: planned.plan.steps,
            requiresActionApproval: planned.plan.steps.some(
              (s) => s.requiresActionApproval,
            ),
          });
          sendEvent("state_update", {
            status: fresh.status,
            run: projectRun(fresh),
          });
          sendEvent("run_completed", { runId });
        } catch (err) {
          sendEvent("error", {
            message: err instanceof Error ? err.message : "执行失败",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
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

// ─── coding 任务：启动 Pi session 并流式推送事件 ────────────────────

async function handleCodingTask(
  runId: string,
  userId: string,
  userInput: string,
  sendEvent: (type: string, payload: unknown) => void,
  signal: AbortSignal,
  requestedModel?: string,
  command: CodingCommand = "goal",
): Promise<void> {
  let piSessionId: string | undefined;
  try {
    const piAgent = getPiSubAgent();

    const subAgentRun = {
      runId: `pi-${runId}`,
      agentType: "pi" as const,
      workspaceId: userId,
      sessionId: "",
      status: "pending" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

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

    const handle = await piAgent.start(subAgentRun, {
      prompt: buildCodingCommandPrompt(command, userInput),
      workspace: process.cwd(),
      contextFiles: [],
      userId,
      provider,
      model: modelName && provider ? { provider, name: modelName } : undefined,
    });

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

    for await (const event of handle.events) {
      if (signal.aborted) {
        await piAgent.cancel(handle.runId).catch(() => {});
        break;
      }
      sendEvent(mapSubAgentEventToSSEType(event), event);
      if (event.type === "run_completed") break;
    }
  } catch (err) {
    if (err instanceof Error && err.name !== "AbortError") {
      sendEvent("pi_error", { message: err.message, piSessionId, command });
    }
  }
}

/** Pi SDK 事件 → SSE 事件类型。 */
function mapSubAgentEventToSSEType(
  event: SubAgentEvent | { type: string; [key: string]: unknown },
): string {
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
    if (assistantEvent?.type === "tool_call") return "pi_tool_call";
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
