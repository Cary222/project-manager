/**
 * 模板工作流启动入口 —— 周报 / 项目进展的唯一启动实现。
 *
 * 为什么单独抽出来：这段逻辑原先只存在于 `app/api/ai/workflows/route.ts` 内部，
 * 而 Next.js 的 route 文件不允许导出非 HTTP 方法（会直接报构建错误），
 * 所以 `/api/ai/work/run` 想复用就只能复制一份 —— 那会变成两套周报启动逻辑，
 * 一旦分叉，"周报走既有可靠 runtime"的约束就名存实亡。
 *
 * 这里把原实现**逐字搬过来**，行为、顺序、幂等语义完全不变：
 *   forceRestart 取消旧 RUN → startWorkflowManually（幂等，可能 skipped）
 *   → weekly_report: startWorkflowAsync（fire-and-forget，不阻塞 HIL）
 *   → project-progress: generateProjectProgressSummary（fire-and-forget）
 *
 * 关键点：`startWorkflowManually` 自己会创建 WorkflowRun 行。
 * 因此调用方**不要**先建行 —— 否则同一次请求会出现两条 run。
 */

import "server-only";

import { prisma } from "@/shared/db/client";
import { startWorkflowManually } from "@/features/ai/runtime/scheduler";
import { WEEKLY_REPORT_WORKFLOW_TYPE } from "@/features/ai/agents/work/workflows/weekly-report/graph";
import { startWorkflowAsync } from "@/features/ai/agents/work/workflows/weekly-report/approval";
import { getWeekRange } from "@/features/weekly-reports/lib/week";
import { generateProjectProgressSummary } from "@/features/ai/agents/work/workflows/project-progress/generate-progress-summary";

/** `/api/ai/workflows` 实际支持的启动类型。 */
export const SUPPORTED_TEMPLATE_TYPES = [
  "weekly_report",
  "project-progress",
] as const;
export type SupportedTemplateType = (typeof SUPPORTED_TEMPLATE_TYPES)[number];

/**
 * 工作流注册表（`listWorkflows()`）用的 type 与启动接口用的 type **并不一致**：
 * 注册表是 `project_progress`，启动接口是 `project-progress`。
 * 这里显式转换，避免把不支持的 type 传给启动器（那会静默不启动）。
 */
export function resolveTemplateType(
  registryType: string,
): SupportedTemplateType | null {
  switch (registryType) {
    case "weekly_report":
      return "weekly_report";
    case "project_progress":
      return "project-progress";
    // meeting_minutes 走的是面板内上传流程，没有异步启动入口；
    // coding 由能力分派处理。两者都不在此列，交给 planner。
    default:
      return null;
  }
}

export interface StartWorkflowOptions {
  userId: string;
  userName?: string;
  workflowType: SupportedTemplateType;
  weekStart?: Date;
  weekEnd?: Date;
  parentScheduleId?: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
  /** 为 true 时先取消该用户同类活跃 RUN。 */
  forceRestart?: boolean;
}

export interface StartWorkflowResult {
  runId: string;
  threadId: string;
  skipped: boolean;
  existingRunId?: string;
  conversationId?: string;
}

export async function startWorkflowByType(
  options: StartWorkflowOptions,
): Promise<StartWorkflowResult> {
  const workflowType = options.workflowType;

  // 与原实现一致：forceRestart 先取消同类活跃 RUN
  if (options.forceRestart) {
    await prisma.workflowRun.updateMany({
      where: {
        userId: options.userId,
        workflowType: options.workflowType,
        kind: "RUN",
        status: { in: ["running", "waiting_review", "pending"] },
      },
      data: { status: "cancelled" },
    });
  }

  const result = await startWorkflowManually({
    ...options,
    conversationId: options.conversationId,
  });

  if (result.skipped) {
    return result;
  }

  // fire-and-forget：不阻塞请求，即使 graph 撞上 HIL 也立即返回
  if (workflowType === WEEKLY_REPORT_WORKFLOW_TYPE) {
    const now = new Date();
    const fallbackRange = getWeekRange(now);
    const weekStart = options.weekStart ?? fallbackRange.weekStart;
    const weekEnd = options.weekEnd ?? now;

    await startWorkflowAsync({
      userId: options.userId,
      userName: options.userName,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      workflowRunId: result.runId,
      threadId: result.threadId,
    });
  } else if (workflowType === "project-progress") {
    void (async () => {
      try {
        await generateProjectProgressSummary(result.runId, options.userId);
      } catch (e) {
        console.error("[project-progress] generation failed:", e);
        await prisma.workflowRun.update({
          where: { id: result.runId },
          data: {
            status: "failed",
            metadata: { error: e instanceof Error ? e.message : "汇总失败" },
          },
        });
      }
    })();
  }

  return { ...result, conversationId: options.conversationId };
}

/**
 * 把 Work Decision 的结论**附加**到模板 run 的 metadata 上。
 *
 * 为什么不用 work-run-store 的 mutateWorkRun：
 * mutateWorkRun 会用 parseMeta 把 metadata 规范化成 Work 编排的形状，
 * 而模板 run 的 metadata 是周报/项目进展自己的结构 ——
 * 两者混用会把模板的字段抹掉。这里只做一次外科式合并，保留原有所有键。
 */
export async function attachDecisionToRun(
  runId: string,
  decision: {
    mode: string;
    intent: string;
    reason: string;
    confidence: number;
    /**
     * 具体结构而非 unknown —— 业务上它就是 decision.ts 的 UnsupportedConcept[]，
     * 写成具体类型既更准确，也让它天然满足 Prisma 的 JSON 可序列化要求。
     */
    unsupportedConcepts?: Array<{ concept: string; why: string; ask: string }>;
  },
): Promise<void> {
  try {
    const row = await prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { metadata: true },
    });
    const existing =
      row?.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        metadata: { ...existing, workDecision: decision },
      },
    });
  } catch (err) {
    // 附加决策信息失败不应影响已启动的模板流程
    console.error("[work] attachDecisionToRun failed:", err);
  }
}
