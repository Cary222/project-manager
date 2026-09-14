/**
 * Plan Executor —— 批准后的计划真正在这里执行（C4 / C6 / C8）。
 *
 * 为什么不能停在 planApproval→END：那只是把计划存下来了，
 * 用户点了「批准」之后什么都不会发生。计划批准必须真的开始执行。
 *
 * 四条硬约束：
 *
 * 1. **幂等**（C8）。stepResults 里 status=done 的步骤永不重跑，
 *    刷新页面 / 重启进程 / 重复提交审批都不会产生第二次副作用。
 *
 * 2. **计划批准 ≠ 动作授权**（C6）。requiresActionApproval 的步骤
 *    在执行前必须拿到针对 (tool, args) 指纹的独立动作审批。
 *    计划批准只授权"做这件事的路线"，不授权"执行这个副作用"。
 *
 * 3. **拒绝不可绕过**（C6）。被拒绝的动作指纹永久记在
 *    deniedActionFingerprints 里。重规划后如果又规划出同一个动作，
 *    直接失败并报明原因 —— 不允许换个说法再做一遍。
 *
 * 4. **未知副作用不重放**（C8）。已提交的写操作如果进程中断，
 *    标记 needs_reconciliation 等人确认，绝不自动重试。
 *    不承诺 exactly-once。
 */

import "server-only";

import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@/features/ai/runtime/tool-registry";
import { globalToolRegistry } from "@/features/ai/runtime/tool-registry";
import { prisma } from "@/shared/db/client";
import { readySteps } from "../planner/validate";
import {
  findActionApproval,
  getPlan,
  type ValidatedStep,
  isActionDenied,
  actionFingerprint,
  loadWorkRun,
  mutateWorkRun,
  recordStepResult,
  requestActionApproval,
  WorkRunStoreError,
  type PendingAction,
  type StepRecord,
  type WorkRunMeta,
  type WorkRunStatus,
} from "../runtime/work-run-store";
import { createBusinessQueryTool } from "../tools/business-query";
import { createBusinessReportTool } from "../tools/business-report";
import { createGenerateTextTool } from "../tools/generate-text";
import { evaluatePlanExecution } from "./evaluator";
import { canReplan, planForRun } from "./plan-for-run";

/** 单次执行循环的步骤上限，防依赖写错导致死循环。 */
const MAX_EXECUTION_STEPS = 32;

export interface ExecutePlanOptions {
  runId: string;
  userId: string;
  isRoot: boolean;
  /** 执行者标识，写进 history 便于审计。 */
  owner?: string;
}

export interface ExecutePlanOutcome {
  status: WorkRunStatus;
  /** 本次真正执行并成功的步骤。 */
  executedStepIds: string[];
  /** 因已 done 而跳过的步骤（幂等证据）。 */
  skippedStepIds: string[];
  pendingAction?: PendingAction;
  failedStepId?: string;
  error?: string;
  artifacts: Record<string, unknown>;
}

// ============================================================================
// 工具解析：run 作用域工具 + 全局注册表
// ============================================================================

/**
 * business_report / generate_text 需要读取上游步骤产出，
 * 所以按 runId 做闭包注入，而不是塞进全局注册表（那会串 run）。
 */
function resolveRunScopedTool(
  name: string,
  runId: string,
  getOutputs: () => Record<string, unknown>,
): ToolDefinition | undefined {
  const withOutputs = (ctx: { runId: string }) =>
    ctx.runId === runId ? getOutputs() : {};
  switch (name) {
    case "business_query":
      return createBusinessQueryTool() as ToolDefinition;
    case "business_report":
      return createBusinessReportTool(withOutputs) as ToolDefinition;
    case "generate_text":
      return createGenerateTextTool(withOutputs) as ToolDefinition;
    default:
      return undefined;
  }
}

function resolveTool(
  name: string,
  runId: string,
  getOutputs: () => Record<string, unknown>,
): ToolDefinition | undefined {
  return (
    resolveRunScopedTool(name, runId, getOutputs) ??
    globalToolRegistry.get(name)
  );
}

// ============================================================================
// 执行
// ============================================================================

/** 从 stepResults 收集已完成步骤 id —— 幂等的依据。 */
function collectDoneIds(meta: WorkRunMeta, planVersion: number): Set<string> {
  const done = new Set<string>();
  for (const step of Object.values(meta.stepResults)) {
    if (step.planVersion === planVersion && step.status === "done") {
      done.add(step.stepId);
    }
  }
  return done;
}

/** 收集上游步骤产出，供 business_report / generate_text 引用。 */
function collectStepOutputs(
  meta: WorkRunMeta,
  planVersion: number,
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const step of Object.values(meta.stepResults)) {
    if (step.planVersion !== planVersion) continue;
    if (step.status !== "done") continue;
    // 工具结果统一放在 result.details 里；没有 details 就退回整个 result。
    const result = step.result as { details?: unknown } | undefined;
    outputs[step.stepId] = result?.details ?? step.result;
  }
  return outputs;
}

/**
 * 执行已批准的计划。
 *
 * 可在三种时机被调用，且都幂等：
 * - 用户点击「批准计划」后
 * - 用户点击「批准动作」后（从 waiting_action_approval 继续）
 * - 崩溃/重启后的恢复流程
 */
export async function executeApprovedPlan(
  options: ExecutePlanOptions,
): Promise<ExecutePlanOutcome> {
  const { runId, userId, isRoot, owner } = options;

  // ── 1. 校验状态：只有 approved 的计划能开始执行
  const row = await loadWorkRun(runId, userId, isRoot);
  const planVersion =
    row.metadata.activePlanVersion ?? row.metadata.planVersion;
  const plan = getPlan(row.metadata, planVersion);

  if (!plan) {
    return {
      status: row.status as WorkRunStatus,
      executedStepIds: [],
      skippedStepIds: [],
      error: `找不到可执行计划（v${planVersion}）`,
      artifacts: row.metadata.artifacts,
    };
  }

  if (plan.status === "rejected" || plan.status === "cancelled") {
    return {
      status: row.status as WorkRunStatus,
      executedStepIds: [],
      skippedStepIds: [],
      error: `计划 v${plan.version} 已被${plan.status === "rejected" ? "拒绝" : "取消"}，不执行`,
      artifacts: row.metadata.artifacts,
    };
  }

  if (plan.status === "completed") {
    return {
      status: "done",
      executedStepIds: [],
      skippedStepIds: plan.steps.map((s) => s.id),
      artifacts: row.metadata.artifacts,
    };
  }

  // ── 2. 标记进入执行态
  await mutateWorkRun(
    runId,
    userId,
    isRoot,
    (meta) => {
      meta.activePlanVersion = planVersion;
      const p = getPlan(meta, planVersion);
      if (p && p.status === "approved") p.status = "executing";
    },
    {
      allowedStatuses: [
        "waiting_plan_approval",
        "running",
        "waiting_action_approval",
        "paused",
      ],
      status: "running",
      event: { event: "plan_execution_started", payload: { planVersion } },
      actor: owner ?? userId,
    },
  );

  // ── 3. 执行循环
  const executed: string[] = [];
  const skipped: string[] = [];
  let artifacts: Record<string, unknown> = {};
  let guard = 0;

  for (;;) {
    if (guard++ > MAX_EXECUTION_STEPS) {
      return {
        status: "error",
        executedStepIds: executed,
        skippedStepIds: skipped,
        error: `执行步数超过上限 ${MAX_EXECUTION_STEPS}，疑似依赖配置异常`,
        artifacts,
      };
    }

    // 每轮重新读，保证并发下的判断基于最新状态
    const current = await loadWorkRun(runId, userId, isRoot);
    const currentPlan = getPlan(current.metadata, planVersion);
    if (!currentPlan) {
      return {
        status: "error",
        executedStepIds: executed,
        skippedStepIds: skipped,
        error: "执行中计划丢失",
        artifacts: current.metadata.artifacts,
      };
    }

    const doneIds = collectDoneIds(current.metadata, planVersion);
    const outputs = collectStepOutputs(current.metadata, planVersion);
    artifacts = current.metadata.artifacts;

    if (doneIds.size === currentPlan.steps.length) {
      // ── C10 评估器（Evaluator）：客观审查步骤产出与目标达成度 ──
      const evaluation = await evaluatePlanExecution({
        userId,
        goal: currentPlan.goal,
        steps: currentPlan.steps,
        stepResults: current.metadata.stepResults,
        stepOutputs: outputs,
      });

      const isReplanVerdict = evaluation.verdict === "replan" || evaluation.verdict === "incomplete";
      const isBlockedVerdict = evaluation.verdict === "blocked" || evaluation.verdict === "needs_human";
      const canRetry = canReplan(current.metadata.replanCount ?? 0, current.metadata.maxReplans ?? 3);

      let finalStatus: WorkRunStatus = "done";
      if (evaluation.verdict === "failed") {
        finalStatus = "error";
      } else if (isBlockedVerdict) {
        finalStatus = "waiting_clarification";
      } else if (isReplanVerdict && canRetry) {
        finalStatus = "waiting_plan_approval";
      } else {
        finalStatus = "done";
      }

      await mutateWorkRun(
        runId,
        userId,
        isRoot,
        (meta) => {
          meta.evaluation = evaluation;
          const p = getPlan(meta, planVersion);
          if (p) p.status = evaluation.verdict === "done" ? "completed" : "failed";
        },
        {
          status: finalStatus,
          event: {
            event: "plan_evaluation_completed",
            payload: { planVersion, verdict: evaluation.verdict, reason: evaluation.reason },
          },
          actor: owner ?? userId,
        },
      );

      // 自动补救闭环：如果目标未达成但仍有预算，自动生成 Plan vN+1 待审批
      if (isReplanVerdict && canRetry) {
        await planForRun({
          runId,
          userId,
          isRoot,
          userInput: currentPlan.goal,
          dataScope: current.metadata.dataScope,
          origin: "replan",
        }).catch((err) => {
          console.warn("[executeApprovedPlan] evaluator auto replan failed:", err);
        });
      }
      // ── 同步最终产出到关联的 WORK 对话记录（保持任务与对话记录完全一致） ──
      if (current.conversationId) {
        let finalContent = "";
        for (const res of Object.values(current.metadata.stepResults)) {
          const content = (res?.result as { content?: string } | undefined)?.content;
          if (content && (content.startsWith("# ") || content.includes("## "))) {
            finalContent = content;
            break;
          }
        }
        if (!finalContent) {
          for (const res of Object.values(current.metadata.stepResults)) {
            const content = (res?.result as { content?: string } | undefined)?.content;
            if (content) finalContent = content;
          }
        }
        if (!finalContent) {
          finalContent = current.metadata.summary || "工作流执行完成。";
        }

        try {
          await prisma.aiChatMessage.create({
            data: {
              conversationId: current.conversationId,
              role: "assistant",
              content: finalContent,
              executionStatus: "COMPLETED",
            },
          });
          await prisma.aiConversation.update({
            where: { id: current.conversationId },
            data: {
              lastMessageAt: new Date(),
              messageCount: { increment: 1 },
              title: currentPlan.title || current.metadata.title,
            },
          });
        } catch (syncErr) {
          console.error("[executeApprovedPlan] sync to conversation failed:", syncErr);
        }
      }
      return {
        status: finalStatus,
        executedStepIds: executed,
        skippedStepIds: skipped,
        artifacts,
      };
    }

    const ready = readySteps(currentPlan.steps, doneIds);
    if (ready.length === 0) {
      return {
        status: "error",
        executedStepIds: executed,
        skippedStepIds: skipped,
        error: "没有可执行的下一步（依赖不可满足），已停止以免死循环",
        artifacts,
      };
    }

    const step = ready[0];
    const specSideEffect = step.requiresActionApproval;

    // ── 3a. 动作审批闸门（C6）
    if (specSideEffect) {
      const fingerprint = actionFingerprint(step.tool, step.args);

      // 拒绝过的动作永久禁止，换计划也不能再做
      if (isActionDenied(current.metadata, step.tool, step.args)) {
        await recordStepResult(
          runId,
          userId,
          isRoot,
          {
            stepId: step.id,
            planVersion,
            status: "failed",
            attempts: 1,
            finishedAt: Date.now(),
            error: "该动作此前已被拒绝，禁止通过其他方式绕过",
          },
          {
            status: "error",
            event: "action_bypass_blocked",
          },
        );
        return {
          status: "error",
          executedStepIds: executed,
          skippedStepIds: skipped,
          failedStepId: step.id,
          error: `动作「${step.tool}」已被拒绝，不允许绕过（指纹 ${fingerprint.slice(0, 24)}…）`,
          artifacts,
        };
      }

      const approved = findActionApproval(
        current.metadata,
        step.tool,
        step.args,
      );
      if (!approved) {
        // 需要人工批准这个具体动作 —— 停下来等
        const approvalId = `act_${runId}_${planVersion}_${step.id}`;
        const pending: PendingAction = {
          runId,
          approvalId,
          planVersion,
          stepId: step.id,
          tool: step.tool,
          args: step.args,
          reason: step.riskNote ?? "该步骤会产生外部副作用",
        };
        await requestActionApproval(userId, isRoot, pending);
        return {
          status: "waiting_action_approval",
          executedStepIds: executed,
          skippedStepIds: skipped,
          pendingAction: pending,
          artifacts,
        };
      }
      // 已批准 → 继续走执行
    }

    // ── 3b. 真正执行
    const tool = resolveTool(step.tool, runId, () => outputs);
    if (!tool) {
      await recordStepResult(
        runId,
        userId,
        isRoot,
        {
          stepId: step.id,
          planVersion,
          status: "failed",
          attempts: 1,
          finishedAt: Date.now(),
          error: `工具 "${step.tool}" 未注册`,
        },
        { status: "error", event: "step_tool_missing" },
      );
      return {
        status: "error",
        executedStepIds: executed,
        skippedStepIds: skipped,
        failedStepId: step.id,
        error: `工具 "${step.tool}" 未注册，计划无法执行`,
        artifacts,
      };
    }

    const stepRecord: StepRecord = {
      stepId: step.id,
      planVersion,
      status: "running",
      startedAt: Date.now(),
      attempts: 1,
    };
    await recordStepResult(runId, userId, isRoot, stepRecord, {
      event: "step_started",
    });

    const ctx: ToolExecutionContext = {
      runId,
      userId,
      agentType: "WORK",
      workflowType: "planning",
    };

    let result: Awaited<ReturnType<ToolDefinition["execute"]>>;
    try {
      result = await tool.execute(ctx, step.args);
    } catch (err) {
      // 工具抛异常：写操作的副作用是否落地未知 → 不重放，等人确认
      const message = err instanceof Error ? err.message : "工具执行异常";
      await recordStepResult(
        runId,
        userId,
        isRoot,
        {
          ...stepRecord,
          status: specSideEffect ? "needs_reconciliation" : "failed",
          finishedAt: Date.now(),
          error: specSideEffect
            ? `执行异常，外部副作用状态未知，需人工确认：${message}`
            : message,
        },
        {
          status: specSideEffect ? "needs_reconciliation" : "error",
          event: specSideEffect ? "step_needs_reconciliation" : "step_failed",
        },
      );
      return {
        status: specSideEffect ? "needs_reconciliation" : "error",
        executedStepIds: executed,
        skippedStepIds: skipped,
        failedStepId: step.id,
        error: specSideEffect
          ? `步骤 ${step.id} 异常中断，外部副作用未知，已标记待人工确认（不会自动重试）`
          : `步骤 ${step.id} 失败：${message}`,
        artifacts,
      };
    }

    if (result.isError) {
      await recordStepResult(
        runId,
        userId,
        isRoot,
        {
          ...stepRecord,
          status: "failed",
          finishedAt: Date.now(),
          error: result.content.slice(0, 500),
        },
        { status: "error", event: "step_failed" },
      );
      return {
        status: "error",
        executedStepIds: executed,
        skippedStepIds: skipped,
        failedStepId: step.id,
        error: `步骤 ${step.id} 失败：${result.content.slice(0, 300)}`,
        artifacts,
      };
    }

    await recordStepResult(
      runId,
      userId,
      isRoot,
      {
        ...stepRecord,
        status: "done",
        finishedAt: Date.now(),
        result: { content: result.content, details: result.details },
        // 有副作用的写操作落地后记标记，作为"已提交，禁止重放"的依据
        sideEffectCommitted: specSideEffect,
      },
      { event: "step_done" },
    );
    executed.push(step.id);
  }
}

/** 便捷判断：这个计划里有没有需要动作审批的步骤。 */
export function planHasSideEffects(steps: ValidatedStep[]): boolean {
  return steps.some((s) => s.requiresActionApproval);
}

export { WorkRunStoreError };
