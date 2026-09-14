/**
 * HIL 审批 API —— 计划审批 + 动作审批（C5 / C6）。
 *
 * 修掉的两个真实缺陷：
 *
 * 1. **404 崩溃**。旧实现无条件走 `piSubAgent.getRun(runId)`，
 *    但 planning 任务活在 `WorkflowRun` 表里，不是 Pi run ——
 *    用户从列表里打开一个已持久化的规划任务再点批准，必然 404。
 *
 * 2. **批准后什么都不发生**。旧实现只把状态改掉，
 *    真正执行在别处。这里批准后直接 `executeApprovedPlan`，计划批准即开始执行。
 *
 * 两条独立的审批层（不可合并）：
 * - scope="plan"   ：批准"走这条路线"。绑定 runId + planVersion + approvalId。
 * - scope="action" ：批准"执行这个具体副作用"。绑定 tool + args 指纹。
 *   计划批准不授权任何副作用 —— 写文件/执行命令仍需单独动作审批。
 *
 * 幂等：approvalId 是幂等键。重复提交返回原结果，不重复执行、不产生第二次副作用。
 * 越权 / 版本过期 / 状态不符 一律拒绝，不静默成功。
 *
 * 拒绝是正常控制流，不是错误：拒绝会带反馈触发有界重规划（≤ maxReplans），
 * 超出预算才落终态 rejected。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { getPiSubAgent } from "@/features/ai/agents/work/subagents/pi/subagent";
import { getPolicyGateway } from "@/features/ai/agents/work/policy";
import {
  decideActionApproval,
  loadWorkRun,
  mutateWorkRun,
  recordApproval,
  projectRun,
  WorkRunStoreError,
  type WorkRunStatus,
} from "@/features/ai/agents/work/runtime/work-run-store";
import { executeApprovedPlan } from "@/features/ai/agents/work/planner/execute";
import {
  planForRun,
  saveEditedPlan,
  canReplan,
} from "@/features/ai/agents/work/planner/plan-for-run";

// ─── 请求体 ─────────────────────────────────────────────────────────

interface WorkApprovalBody {
  runId: string;
  scope: "plan" | "action";
  approvalId: string;
  planVersion?: number;
  decision: "approve" | "reject" | "cancel" | "edit";
  feedback?: string;
  editedSteps?: unknown;
  editedTitle?: string;
}

interface LegacyPiApprovalBody {
  runId: string;
  callId: string;
  decision: "approve" | "deny";
  reason?: string;
}

function storeErrorToResponse(err: unknown): NextResponse {
  if (err instanceof WorkRunStoreError) {
    const status =
      err.code === "not_found"
        ? 404
        : err.code === "forbidden"
          ? 403
          : err.code === "revision_conflict"
            ? 409
            : err.code === "invalid_transition"
              ? 409
              : 500;
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }
  return NextResponse.json(
    {
      error: "Internal server error",
      details: err instanceof Error ? err.message : String(err),
    },
    { status: 500 },
  );
}

// ─── POST ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const isRoot = session.user.role === "ROOT";

    const body = (await request.json()) as Partial<
      WorkApprovalBody & LegacyPiApprovalBody
    >;

    if (!body.runId) {
      return NextResponse.json(
        { error: "Missing required field: runId" },
        { status: 400 },
      );
    }

    // 有 scope 走 Work 持久化路径；否则退回旧的 Pi 路径（coding 任务仍在用）。
    if (body.scope === "plan" || body.scope === "action") {
      return await handleWorkApproval({
        body: body as WorkApprovalBody,
        userId,
        isRoot,
      });
    }
    return await handleLegacyPiApproval({
      body: body as LegacyPiApprovalBody,
      userId,
    });
  } catch (error) {
    return storeErrorToResponse(error);
  }
}

// ─── Work 路径 ──────────────────────────────────────────────────────

async function handleWorkApproval(input: {
  body: WorkApprovalBody;
  userId: string;
  isRoot: boolean;
}): Promise<NextResponse> {
  const { body, userId, isRoot } = input;

  if (!body.approvalId) {
    return NextResponse.json(
      { error: "Missing required field: approvalId" },
      { status: 400 },
    );
  }
  if (!["approve", "reject", "cancel", "edit"].includes(body.decision)) {
    return NextResponse.json(
      {
        error:
          'Invalid decision. Must be one of "approve" | "reject" | "cancel" | "edit"',
      },
      { status: 400 },
    );
  }

  return body.scope === "action"
    ? handleActionApproval({ body, userId, isRoot })
    : handlePlanApproval({ body, userId, isRoot });
}

async function handlePlanApproval(input: {
  body: WorkApprovalBody;
  userId: string;
  isRoot: boolean;
}): Promise<NextResponse> {
  const { body, userId, isRoot } = input;

  // 读一次拿到 planVersion / 用户目标 / 重规划预算
  const current = await loadWorkRun(body.runId, userId, isRoot);
  const planVersion = body.planVersion ?? current.metadata.planVersion;

  // ── 用户编辑：走同一套 critic 落成新版本待批，校验不能绕过
  if (body.decision === "edit") {
    if (body.editedSteps === undefined) {
      return NextResponse.json(
        { error: "decision=edit 必须提供 editedSteps" },
        { status: 400 },
      );
    }
    const edited = await saveEditedPlan({
      runId: body.runId,
      userId,
      isRoot,
      userInput: current.metadata.userInput,
      title: body.editedTitle ?? current.metadata.title,
      steps: body.editedSteps,
    });
    if (!edited.ok) {
      return NextResponse.json(
        { error: edited.error, errors: edited.errors },
        { status: 422 },
      );
    }
    return NextResponse.json({
      success: true,
      decision: "edit",
      message: "计划已更新并通过校验，等待你的批准",
      run: projectRun(
        edited.ok ? await loadWorkRun(body.runId, userId, isRoot) : current,
      ),
    });
  }

  const plan = current.metadata.plans[String(planVersion)];
  if (!plan) {
    return NextResponse.json(
      { error: `计划版本 v${planVersion} 不存在` },
      { status: 404 },
    );
  }

  // ── 落审批（幂等）
  const { row, idempotent } = await recordApproval(
    {
      runId: body.runId,
      actorUserId: userId,
      isRoot,
      approvalId: body.approvalId,
      planVersion,
      decision: body.decision,
      feedback: body.feedback,
      allowedStatuses: ["waiting_plan_approval"],
    },
    (meta) => {
      if (body.decision === "approve") {
        meta.activePlanVersion = planVersion;
        return "running";
      }
      if (body.decision === "cancel") {
        return "cancelled";
      }
      // reject：先标记，下面按预算决定重规划还是落终态
      return "waiting_plan_approval";
    },
  );

  if (idempotent) {
    return NextResponse.json({
      success: true,
      idempotent: true,
      message: "该审批已处理过，未重复执行",
      run: projectRun(row),
    });
  }

  // ── 批准 → 真正开始执行
  if (body.decision === "approve") {
    const outcome = await executeApprovedPlan({
      runId: body.runId,
      userId,
      isRoot,
      owner: `approve:${userId}`,
    });
    const finalRow = await loadWorkRun(body.runId, userId, isRoot);
    return NextResponse.json({
      success: outcome.status !== "error",
      decision: "approve",
      execution: {
        status: outcome.status,
        executedStepIds: outcome.executedStepIds,
        skippedStepIds: outcome.skippedStepIds,
        pendingAction: outcome.pendingAction ?? null,
        failedStepId: outcome.failedStepId ?? null,
        error: outcome.error ?? null,
      },
      run: projectRun(finalRow),
    });
  }

  if (body.decision === "cancel") {
    return NextResponse.json({
      success: true,
      decision: "cancel",
      message: "任务已取消",
      run: projectRun(await loadWorkRun(body.runId, userId, isRoot)),
    });
  }

  // ── 拒绝：正常控制流。带反馈有界重规划，超预算落终态。
  return await replanAfterRejection({
    runId: body.runId,
    userId,
    isRoot,
    feedback: body.feedback ?? "用户拒绝了该计划，未说明原因",
    current: await loadWorkRun(body.runId, userId, isRoot),
  });
}

/**
 * 拒绝后的有界重规划。
 * 关键：把拒绝理由原样喂回 planner，且重规划次数受 maxReplans 限制 ——
 * 否则模型会无限重试同一条被否决的路线。
 */
async function replanAfterRejection(input: {
  runId: string;
  userId: string;
  isRoot: boolean;
  feedback: string;
  current: Awaited<ReturnType<typeof loadWorkRun>>;
}): Promise<NextResponse> {
  const { runId, userId, isRoot, feedback, current } = input;

  // 同步用户修改意见/反馈到关联的 WORK 对话记录
  if (current.conversationId && feedback) {
    try {
      await prisma.aiChatMessage.create({
        data: {
          conversationId: current.conversationId,
          role: "user",
          content: `[调整建议]: ${feedback}`,
        },
      });
      await prisma.aiConversation.update({
        where: { id: current.conversationId },
        data: {
          lastMessageAt: new Date(),
          messageCount: { increment: 1 },
        },
      });
    } catch (syncErr) {
      console.error("[replanAfterRejection] sync feedback to conversation failed:", syncErr);
    }
  }

  if (!canReplan(current.metadata.replanCount, current.metadata.maxReplans)) {
    const row = await mutateWorkRun(runId, userId, isRoot, () => {}, {
      status: "rejected",
      allowedStatuses: ["waiting_plan_approval", "running"],
      event: {
        event: "replan_budget_exhausted",
        payload: { replanCount: current.metadata.replanCount },
      },
    });
    return NextResponse.json({
      success: true,
      decision: "reject",
      replanned: false,
      message: `已拒绝。重规划次数已达上限（${current.metadata.maxReplans}），任务终止。`,
      run: projectRun(row),
    });
  }

  // 记一次重规划，清空活跃计划版本（旧计划已被拒绝）
  await mutateWorkRun(
    runId,
    userId,
    isRoot,
    (meta) => {
      meta.replanCount += 1;
      meta.activePlanVersion = null;
    },
    {
      status: "planning",
      allowedStatuses: ["waiting_plan_approval", "running"],
      event: { event: "replan_started", payload: { feedback } },
    },
  );

  const replanned = await planForRun({
    runId,
    userId,
    isRoot,
    userInput: current.metadata.userInput,
    entities: current.metadata.decision?.entities,
    feedback,
    origin: "replan",
  });

  if (!replanned.ok) {
    await mutateWorkRun(runId, userId, isRoot, () => {}, {
      status: "error",
      allowedStatuses: ["planning", "waiting_plan_approval"],
      event: { event: "replan_failed", payload: { error: replanned.error } },
    });
    return NextResponse.json(
      {
        success: false,
        decision: "reject",
        replanned: false,
        error: `重规划失败：${replanned.error}`,
        errors: replanned.errors,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    success: true,
    decision: "reject",
    replanned: true,
    message: `已拒绝并按你的意见重新规划（第 ${current.metadata.replanCount + 1} 次），请审阅新计划。`,
    run: projectRun(await loadWorkRun(runId, userId, isRoot)),
  });
}

async function handleActionApproval(input: {
  body: WorkApprovalBody;
  userId: string;
  isRoot: boolean;
}): Promise<NextResponse> {
  const { body, userId, isRoot } = input;

  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json(
      { error: '动作审批只接受 "approve" 或 "reject"' },
      { status: 400 },
    );
  }

  const { row, idempotent } = await decideActionApproval({
    runId: body.runId,
    actorUserId: userId,
    isRoot,
    approvalId: body.approvalId,
    decision: body.decision,
    feedback: body.feedback,
  });

  if (idempotent) {
    return NextResponse.json({
      success: true,
      idempotent: true,
      message: "该动作审批已处理过，未重复执行",
      run: projectRun(row),
    });
  }

  if (body.decision === "reject") {
    // 动作被拒 = 这条路走不通。带反馈重规划，且该动作指纹已被永久封禁。
    return await replanAfterRejection({
      runId: body.runId,
      userId,
      isRoot,
      feedback: `用户拒绝执行动作「${body.approvalId}」：${body.feedback ?? "未说明原因"}。请规划不包含该动作的替代方案。`,
      current: await loadWorkRun(body.runId, userId, isRoot),
    });
  }

  // 批准动作 → 继续执行剩余的步骤
  const outcome = await executeApprovedPlan({
    runId: body.runId,
    userId,
    isRoot,
    owner: `action-approve:${userId}`,
  });
  const finalRow = await loadWorkRun(body.runId, userId, isRoot);

  return NextResponse.json({
    success: outcome.status !== "error",
    decision: "approve",
    scope: "action",
    execution: {
      status: outcome.status,
      executedStepIds: outcome.executedStepIds,
      skippedStepIds: outcome.skippedStepIds,
      pendingAction: outcome.pendingAction ?? null,
      failedStepId: outcome.failedStepId ?? null,
      error: outcome.error ?? null,
    },
    run: projectRun(finalRow),
  });
}

// ─── 旧 Pi 路径（coding 任务）───────────────────────────────────────

async function handleLegacyPiApproval(input: {
  body: LegacyPiApprovalBody;
  userId: string;
}): Promise<NextResponse> {
  const { body } = input;

  if (!body.callId || !body.decision) {
    return NextResponse.json(
      { error: "Missing required fields: callId, decision" },
      { status: 400 },
    );
  }
  if (body.decision !== "approve" && body.decision !== "deny") {
    return NextResponse.json(
      { error: 'Invalid decision. Must be "approve" or "deny"' },
      { status: 400 },
    );
  }

  const piSubAgent = getPiSubAgent();
  const policyGateway = getPolicyGateway();

  const run = piSubAgent.getRun(body.runId);
  if (!run) {
    return NextResponse.json(
      {
        error: `Run not found: ${body.runId}`,
        hint: '若这是规划/统计类任务，请带 scope="plan" 提交（它持久化在 WorkflowRun 而非 Pi run）。',
      },
      { status: 404 },
    );
  }

  const logId = await policyGateway.findPendingApproval(body.runId);
  if (!logId) {
    return NextResponse.json(
      { error: `No pending approval found for runId: ${body.runId}` },
      { status: 404 },
    );
  }

  await policyGateway.updateApproval(
    logId,
    body.decision === "approve",
    input.userId,
  );

  if (body.decision === "approve") {
    await piSubAgent.resume(
      body.runId,
      body.reason || "User approved the action. Please proceed.",
    );
    return NextResponse.json({
      success: true,
      decision: "approve",
      message: "Tool call approved and execution resumed",
    });
  }

  await piSubAgent.cancel(body.runId);
  return NextResponse.json({
    success: true,
    decision: "deny",
    message: "Tool call denied and run cancelled",
  });
}

// ─── GET：查询某个 run 的待审批项 ───────────────────────────────────

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");
    if (!runId) {
      return NextResponse.json(
        { error: "Missing required query parameter: runId" },
        { status: 400 },
      );
    }

    const isRoot = session.user.role === "ROOT";

    // Work 持久化路径优先：planning 任务的待审批项在 WorkflowRun.metadata 里，
    // 不在 Pi 审计日志里。旧实现的 404 就出在这里。
    try {
      const row = await loadWorkRun(runId, session.user.id, isRoot);
      const pendingActions = Object.entries(row.metadata.artifacts)
        .filter(([key]) => key.startsWith("pending_action:"))
        .map(([, value]) => value as Record<string, unknown>);

      const latestPlan = row.metadata.plans[String(row.metadata.planVersion)];
      const needsPlanApproval = latestPlan?.status === "pending_approval";

      return NextResponse.json({
        runId,
        source: "WorkflowRun",
        status: row.status,
        needsPlanApproval,
        planApproval: needsPlanApproval
          ? {
              approvalId: `plan_${runId}_v${latestPlan.version}`,
              planVersion: latestPlan.version,
              title: latestPlan.title,
              steps: latestPlan.steps,
            }
          : null,
        pendingApprovals: pendingActions,
        decision: row.metadata.decision ?? null,
      });
    } catch (err) {
      if (!(err instanceof WorkRunStoreError) || err.code !== "not_found") {
        throw err;
      }
      // 不是 Work run → 退回旧 Pi 审计日志查询
    }

    const policyGateway = getPolicyGateway();
    const auditLog = await policyGateway.getAuditLog({
      runId,
      decision: "approve",
    });
    const pendingApprovals = auditLog.filter(
      (entry) => !entry.timestamp.includes("approved"),
    );

    return NextResponse.json({
      runId,
      source: "pi-audit-log",
      pendingApprovals: pendingApprovals.map((entry) => ({
        callId: entry.tool || "unknown",
        tool: entry.tool,
        args: {},
        reason: entry.reason,
        timestamp: entry.timestamp,
      })),
    });
  } catch (error) {
    return storeErrorToResponse(error);
  }
}

export type { WorkApprovalBody, LegacyPiApprovalBody, WorkRunStatus };
