/**
 * WorkRunStore — Work 编排的唯一持久化真相源。
 *
 * 设计约束（已批准）：
 * - 不新增表、不改 Prisma schema、不执行远程 DDL。
 * - `WorkflowRun.metadata` 存权威状态机，`WorkflowRun.history` 存 append-only 事件流。
 * - 并发安全用 Postgres Serializable 事务 + metadata.revision 做 CAS/fencing，
 *   冲突（P2034）自动重试。这是真 CAS，不是内存锁，跨进程/重启都成立。
 *
 * 状态机：
 *   planning → waiting_clarification → waiting_plan_approval
 *     → running → waiting_action_approval → running → done
 *     → rejected / cancelled / error / needs_reconciliation
 *
 * `needs_reconciliation` 用于"外部副作用未知"（崩溃/超时后不确定是否已执行），
 * 绝不自动重放，等人确认。不承诺 exactly-once。
 */

import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";

// ============================================================================
// 状态与类型
// ============================================================================

export type WorkRunStatus =
  | "planning"
  | "waiting_clarification"
  | "waiting_plan_approval"
  | "running"
  | "waiting_action_approval"
  | "paused"
  | "needs_reconciliation"
  | "done"
  | "rejected"
  | "cancelled"
  | "error";

/** 终态：不会再自动推进，只能由人显式重开或丢弃。 */
export const TERMINAL_STATUSES: WorkRunStatus[] = [
  "done",
  "rejected",
  "cancelled",
  "error",
];

export type PlanStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "cancelled"
  | "superseded"
  | "executing"
  | "completed"
  | "failed";

export type ApprovalScope = "plan" | "action";
export type ApprovalDecision = "approve" | "reject" | "cancel" | "edit";

/** 经校验的步骤：id 唯一、工具在白名单、参数已解析、依赖无悬空无环。 */
export interface ValidatedStep {
  id: string;
  action: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn: string[];
  /** true = 有外部副作用，必须单独 Action Approval。 */
  requiresActionApproval: boolean;
  /** 步骤级风险说明，UI 展示。 */
  riskNote?: string;
}

export interface PlanRecord {
  version: number;
  title: string;
  goal: string;
  steps: ValidatedStep[];
  createdAt: number;
  createdBy: string;
  status: PlanStatus;
  validation: { ok: boolean; errors: string[] };
  origin: { kind: "initial" | "replan" | "edit"; feedback?: string };
}

export interface ApprovalRecord {
  approvalId: string;
  scope: ApprovalScope;
  planVersion: number;
  stepId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  fingerprint: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: number;
  feedback?: string;
}

export interface StepRecord {
  stepId: string;
  planVersion: number;
  status:
    | "pending"
    | "running"
    | "done"
    | "failed"
    | "waiting_action_approval"
    | "action_rejected"
    | "needs_reconciliation"
    | "skipped";
  startedAt?: number;
  finishedAt?: number;
  attempts: number;
  result?: unknown;
  error?: string;
  /** 该步骤是否已产生外部副作用（写操作已落地）。用于禁止重放。 */
  sideEffectCommitted?: boolean;
  approvalId?: string;
}

export interface EvaluationRecord {
  verdict: "done" | "replan" | "needs_human" | "failed" | "incomplete" | "blocked";
  reason: string;
  observed: string[];
  at: number;
}

export interface WorkRunMeta {
  schemaVersion: 1;
  revision: number;
  title: string;
  userInput: string;
  decision?: {
    intent: string;
    reason: string;
    entities: Record<string, unknown>;
    mode: string;
    requestedWorkflow?: string;
    missingInfo?: string[];
    clarification?: string;
    createdAt: number;
  };
  planVersion: number;
  activePlanVersion: number | null;
  plans: Record<string, PlanRecord>;
  stepResults: Record<string, StepRecord>;
  approvals: Record<string, ApprovalRecord>;
  /** 被拒绝的 action 指纹，跨 replan 保留，禁止绕过。 */
  deniedActionFingerprints: string[];
  replanCount: number;
  maxReplans: number;
  evaluation?: EvaluationRecord;
  artifacts: Record<string, unknown>;
  summary?: string | null;
  error?: string | null;
  /** 数据权限范围快照，UI 必须如实展示。 */
  dataScope?: {
    mode: "all_projects" | "member_projects";
    projectIds: string[];
    truncated: boolean;
  };
}

export interface HistoryEvent {
  timestamp: string;
  event: string;
  payload?: Record<string, unknown>;
}

export interface WorkRunRow {
  id: string;
  userId: string;
  status: string;
  workflowType: string;
  conversationId?: string | null;
  metadata: WorkRunMeta;
  history: HistoryEvent[];
  updatedAt: Date;
}

// ============================================================================
// 默认值 / 解析
// ============================================================================

export function emptyMeta(title: string, userInput: string): WorkRunMeta {
  return {
    schemaVersion: 1,
    revision: 0,
    title,
    userInput,
    planVersion: 0,
    activePlanVersion: null,
    plans: {},
    stepResults: {},
    approvals: {},
    deniedActionFingerprints: [],
    replanCount: 0,
    maxReplans: 3,
    artifacts: {},
    summary: null,
    error: null,
  };
}

/** 容错解析历史脏数据：缺字段补默认，绝不抛。 */
export function parseMeta(
  raw: unknown,
  fallbackTitle = "Work 任务",
): WorkRunMeta {
  const base = emptyMeta(fallbackTitle, "");
  if (!raw || typeof raw !== "object") return base;
  const m = raw as Partial<WorkRunMeta>;
  return {
    ...base,
    ...m,
    schemaVersion: 1,
    revision: typeof m.revision === "number" ? m.revision : 0,
    title: typeof m.title === "string" && m.title ? m.title : fallbackTitle,
    plans: m.plans && typeof m.plans === "object" ? m.plans : {},
    stepResults:
      m.stepResults && typeof m.stepResults === "object" ? m.stepResults : {},
    approvals:
      m.approvals && typeof m.approvals === "object" ? m.approvals : {},
    deniedActionFingerprints: Array.isArray(m.deniedActionFingerprints)
      ? m.deniedActionFingerprints
      : [],
    artifacts:
      m.artifacts && typeof m.artifacts === "object" ? m.artifacts : {},
    maxReplans: typeof m.maxReplans === "number" ? m.maxReplans : 3,
    replanCount: typeof m.replanCount === "number" ? m.replanCount : 0,
  };
}

function parseHistory(raw: unknown): HistoryEvent[] {
  return Array.isArray(raw) ? (raw as HistoryEvent[]) : [];
}

/**
 * SAFETY: WorkRunMeta / HistoryEvent 都是纯 JSON 可序列化结构（string/number/
 * boolean/null/普通对象与数组，无 Date、Map、undefined 值），Prisma 的
 * InputJsonValue 只是不接受 TS 的宽索引签名，运行时结构是合法的。
 */
function jsonOf(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Action 指纹：tool + 规范化 args。拒绝过的动作换计划也不能再执行。 */
export function actionFingerprint(
  tool: string,
  args: Record<string, unknown>,
): string {
  return `${tool}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// ============================================================================
// CAS 变更
// ============================================================================

export type Tx = Prisma.TransactionClient;

export interface MutateOptions {
  /** 乐观锁：调用方读到的 revision。不一致直接抛 RevisionConflict，不静默覆盖。 */
  expectedRevision?: number;
  /** 要求当前状态在集合内，否则抛 InvalidTransition。 */
  allowedStatuses?: WorkRunStatus[];
  /** 同时改顶层 status。 */
  /**
   * 同时改顶层 status。传函数可拿到 mutator 改完后的 meta ——
   * options 对象在 mutator 之前构造，函数式才能表达"下一步状态取决于本次改动"。
   */
  status?: WorkRunStatus | ((meta: WorkRunMeta) => WorkRunStatus);
  /** 追加历史事件。 */
  event?: {
    event: string;
    /** 传函数可拿到 mutator 改完后的 meta（options 对象在 mutator 之前构造）。 */
    payload?:
      | Record<string, unknown>
      | ((meta: WorkRunMeta) => Record<string, unknown>);
  };
  /** 调用方：用于 lease/fencing 记录。 */
  actor?: string;
  maxRetries?: number;
}

export class WorkRunStoreError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "forbidden"
      | "revision_conflict"
      | "invalid_transition"
      | "serialization_failure"
      | "duplicate_approval",
    message: string,
  ) {
    super(message);
    this.name = "WorkRunStoreError";
  }
}

/**
 * 在一个 Serializable 事务里读-改-写一条 WorkflowRun。
 *
 * mutator 必须是纯函数：拿到 metadata 副本，改它，返回。
 * 副作用（发 SSE、调 LLM、跑工具）不要放进来 —— 事务会重试。
 */
export async function mutateWorkRun(
  runId: string,
  actorUserId: string,
  isRoot: boolean,
  mutator: (meta: WorkRunMeta, row: WorkRunRow) => void | Promise<void>,
  options: MutateOptions = {},
): Promise<WorkRunRow> {
  const maxRetries = options.maxRetries ?? 4;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await prisma.$transaction(
        async (tx) =>
          doMutate(tx, runId, actorUserId, isRoot, mutator, options),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // 40001 = serialization_failure，P2034 = Prisma 的写冲突
      const code =
        err instanceof Prisma.PrismaClientKnownRequestError
          ? err.code
          : undefined;
      const pgCode =
        err instanceof Prisma.PrismaClientKnownRequestError
          ? ((err.meta as { code?: string } | undefined)?.code ?? undefined)
          : undefined;
      const retryable =
        code === "P2034" || pgCode === "40001" || pgCode === "40P01";
      if (retryable && attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 20 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function doMutate(
  tx: Tx,
  runId: string,
  actorUserId: string,
  isRoot: boolean,
  mutator: (meta: WorkRunMeta, row: WorkRunRow) => void | Promise<void>,
  options: MutateOptions,
): Promise<WorkRunRow> {
  const found = await tx.workflowRun.findUnique({ where: { id: runId } });
  if (!found) throw new WorkRunStoreError("not_found", `Run 不存在: ${runId}`);

  // 服务端权限边界：非 ROOT 只能操作自己的 run。
  if (!isRoot && found.userId !== actorUserId) {
    throw new WorkRunStoreError("forbidden", "无权操作该任务");
  }

  const row: WorkRunRow = {
    id: found.id,
    userId: found.userId,
    status: found.status,
    workflowType: found.workflowType,
    conversationId: found.conversationId ?? null,
    metadata: parseMeta(found.metadata, "Work 任务"),
    history: parseHistory(found.history),
    updatedAt: found.updatedAt,
  };

  if (
    options.expectedRevision !== undefined &&
    row.metadata.revision !== options.expectedRevision
  ) {
    throw new WorkRunStoreError(
      "revision_conflict",
      `版本冲突：期望 ${options.expectedRevision}，实际 ${row.metadata.revision}`,
    );
  }

  if (
    options.allowedStatuses &&
    !options.allowedStatuses.includes(row.status as WorkRunStatus)
  ) {
    throw new WorkRunStoreError(
      "invalid_transition",
      `当前状态 ${row.status} 不允许此操作（需要 ${options.allowedStatuses.join("/")}）`,
    );
  }

  const meta = structuredClone(row.metadata);
  await mutator(meta, row);

  meta.revision += 1;

  const history: HistoryEvent[] = [...row.history];
  if (options.event) {
    history.push({
      timestamp: new Date().toISOString(),
      event: options.event.event,
      payload: {
        ...(typeof options.event.payload === "function"
          ? options.event.payload(meta)
          : (options.event.payload ?? {})),
        revision: meta.revision,
        actor: options.actor ?? actorUserId,
      },
    });
  }
  // history 是 Json 列，长任务会无限增长 —— 只保留最近 400 条。
  const trimmed =
    history.length > 400 ? history.slice(history.length - 400) : history;

  // 在 mutator 之后求值，这样函数式 status 才能反映本次改动。
  const nextStatus =
    typeof options.status === "function"
      ? options.status(meta)
      : (options.status ?? (row.status as WorkRunStatus));
  const updated = await tx.workflowRun.update({
    where: { id: runId },
    data: {
      status: nextStatus,
      metadata: jsonOf(meta),
      history: jsonOf(trimmed),
    },
  });

  return {
    id: updated.id,
    userId: updated.userId,
    status: updated.status,
    workflowType: updated.workflowType,
    conversationId: updated.conversationId ?? null,
    metadata: parseMeta(updated.metadata, "Work 任务"),
    history: parseHistory(updated.history),
    updatedAt: updated.updatedAt,
  };
}

// ============================================================================
// 读取
// ============================================================================

export async function loadWorkRun(
  runId: string,
  actorUserId: string,
  isRoot: boolean,
): Promise<WorkRunRow> {
  const found = await prisma.workflowRun.findUnique({ where: { id: runId } });
  if (!found) throw new WorkRunStoreError("not_found", `Run 不存在: ${runId}`);
  if (!isRoot && found.userId !== actorUserId) {
    throw new WorkRunStoreError("forbidden", "无权访问该任务");
  }
  return {
    id: found.id,
    userId: found.userId,
    status: found.status,
    workflowType: found.workflowType,
    conversationId: found.conversationId ?? null,
    metadata: parseMeta(found.metadata, "Work 任务"),
    history: parseHistory(found.history),
    updatedAt: found.updatedAt,
  };
}

/**
 * 幂等创建：同 id 已存在则原样返回，不覆盖。
 * 关键顺序 —— 先落库成功，再通知 UI（C4）。
 */
export async function createWorkRun(input: {
  runId: string;
  userId: string;
  title: string;
  userInput: string;
  status: WorkRunStatus;
  workflowType?: string;
  conversationId?: string | null;
  meta?: Partial<WorkRunMeta>;
}): Promise<WorkRunRow> {
  const meta: WorkRunMeta = {
    ...emptyMeta(input.title, input.userInput),
    ...input.meta,
    schemaVersion: 1,
    title: input.title,
    userInput: input.userInput,
  };
  try {
    const created = await prisma.workflowRun.create({
      data: {
        id: input.runId,
        kind: "RUN",
        userId: input.userId,
        workflowType: input.workflowType ?? "planning",
        threadId: input.runId,
        conversationId: input.conversationId ?? null,
        status: input.status,
        metadata: jsonOf(meta),
        history: jsonOf([
          {
            timestamp: new Date().toISOString(),
            event: "run_created",
            payload: { title: input.title, status: input.status },
          } satisfies HistoryEvent,
        ]),
      },
    });
    return {
      id: created.id,
      userId: created.userId,
      status: created.status,
      workflowType: created.workflowType,
      conversationId: created.conversationId ?? null,
      metadata: parseMeta(created.metadata, input.title),
      history: parseHistory(created.history),
      updatedAt: created.updatedAt,
    };
  } catch (err) {
    // 唯一约束冲突 = 已存在，幂等返回现状而不是覆盖。
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return loadWorkRun(input.runId, input.userId, true);
    }
    throw err;
  }
}

// ============================================================================
// 计划版本
// ============================================================================

/** 写入新计划版本（原子）。返回新版本号。 */
export async function savePlanVersion(
  runId: string,
  actorUserId: string,
  isRoot: boolean,
  plan: Omit<PlanRecord, "version" | "createdAt" | "createdBy">,
  options: { status?: WorkRunStatus; event?: string } = {},
): Promise<PlanRecord> {
  let saved: PlanRecord | undefined;
  await mutateWorkRun(
    runId,
    actorUserId,
    isRoot,
    (meta) => {
      // 旧版本全部标 superseded —— 只有最新版能被批准。
      for (const key of Object.keys(meta.plans)) {
        const p = meta.plans[key];
        if (p.status === "pending_approval") p.status = "superseded";
      }
      const version = meta.planVersion + 1;
      const record: PlanRecord = {
        ...plan,
        version,
        createdAt: Date.now(),
        createdBy: actorUserId,
      };
      meta.plans[String(version)] = record;
      meta.planVersion = version;
      meta.activePlanVersion = null;
      meta.title = record.title || meta.title;
      saved = record;
    },
    {
      status: options.status,
      event: {
        event: options.event ?? "plan_version_saved",
        payload: (m) => ({ planVersion: m.planVersion }),
      },
    },
  );
  if (!saved) {
    throw new WorkRunStoreError("serialization_failure", "计划版本写入失败");
  }
  return saved;
}

export function getPlan(
  meta: WorkRunMeta,
  version: number,
): PlanRecord | undefined {
  return meta.plans[String(version)];
}

// ============================================================================
// 审批
// ============================================================================

/**
 * 幂等审批：同一 approvalId 重复提交返回原结果，不重复执行（C5）。
 * 越权 / 版本过期 / 状态不符 都抛错，不静默成功。
 */
export interface ApprovePlanInput {
  runId: string;
  actorUserId: string;
  isRoot: boolean;
  approvalId: string;
  planVersion: number;
  decision: Exclude<ApprovalDecision, "edit"> | "edit";
  feedback?: string;
  editedSteps?: ValidatedStep[];
  /** 只接受这些 run 状态。 */
  allowedStatuses: WorkRunStatus[];
}

export async function recordApproval(
  input: ApprovePlanInput,
  apply: (meta: WorkRunMeta, plan: PlanRecord) => WorkRunStatus,
): Promise<{ row: WorkRunRow; idempotent: boolean }> {
  let idempotent = false;
  // 由 mutator 里的 apply() 决定 —— 批准要走 running，拒绝/取消各有终态。
  let nextStatus: WorkRunStatus | undefined;
  const row = await mutateWorkRun(
    input.runId,
    input.actorUserId,
    input.isRoot,
    (meta, row) => {
      const existing = meta.approvals[input.approvalId];
      if (existing) {
        // 已处理过 —— 幂等返回，不重复执行也不推进状态。
        idempotent = true;
        nextStatus = row.status as WorkRunStatus;
        return;
      }
      const plan = getPlan(meta, input.planVersion);
      if (!plan) {
        throw new WorkRunStoreError(
          "not_found",
          `计划版本不存在: v${input.planVersion}`,
        );
      }
      if (
        meta.activePlanVersion !== null &&
        meta.activePlanVersion !== input.planVersion
      ) {
        throw new WorkRunStoreError(
          "invalid_transition",
          `计划版本已过期：当前活跃 v${meta.activePlanVersion}，提交 v${input.planVersion}`,
        );
      }
      if (plan.status !== "pending_approval") {
        throw new WorkRunStoreError(
          "invalid_transition",
          `计划 v${plan.version} 状态为 ${plan.status}，不可审批`,
        );
      }

      const record: ApprovalRecord = {
        approvalId: input.approvalId,
        scope: "plan",
        planVersion: input.planVersion,
        fingerprint: `plan:v${input.planVersion}`,
        decision: input.decision,
        decidedBy: input.actorUserId,
        decidedAt: Date.now(),
        feedback: input.feedback,
      };
      meta.approvals[input.approvalId] = record;

      if (input.decision === "edit" && input.editedSteps) {
        plan.status = "superseded";
        // 由调用方在 apply 里 savePlanVersion —— 这里只标记。
      } else {
        plan.status =
          input.decision === "approve"
            ? "approved"
            : input.decision === "reject"
              ? "rejected"
              : "cancelled";
      }
      // apply 返回的状态必须真的生效 —— 否则计划批准后 run 仍停在 waiting_plan_approval。
      nextStatus = apply(meta, plan);
    },
    {
      allowedStatuses: input.allowedStatuses,
      // 函数式：mutator 跑完才有值。两条路径（幂等 / apply）都会赋值。
      status: () => nextStatus ?? "waiting_plan_approval",
      event: {
        event: `plan_${input.decision}`,
        payload: {
          approvalId: input.approvalId,
          planVersion: input.planVersion,
          feedback: input.feedback,
        },
      },
    },
  );
  return { row, idempotent };
}

// ============================================================================
// Action Approval（C6）
// ============================================================================

/** 待审批动作：绑定 tool + args + callId，计划批准不授权它。 */
export interface PendingAction {
  runId: string;
  approvalId: string;
  planVersion: number;
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export async function requestActionApproval(
  actorUserId: string,
  isRoot: boolean,
  action: PendingAction,
): Promise<void> {
  const fingerprint = actionFingerprint(action.tool, action.args);
  await mutateWorkRun(
    action.runId,
    actorUserId,
    isRoot,
    (meta) => {
      if (meta.deniedActionFingerprints.includes(fingerprint)) {
        throw new WorkRunStoreError(
          "invalid_transition",
          `该操作已被拒绝，禁止换计划绕过: ${action.tool}`,
        );
      }
      const step = meta.stepResults[action.stepId];
      if (step) {
        step.status = "waiting_action_approval";
        step.approvalId = action.approvalId;
      }
      meta.artifacts[`pending_action:${action.approvalId}`] = {
        ...action,
        fingerprint,
        requestedAt: Date.now(),
      };
    },
    {
      status: "waiting_action_approval",
      allowedStatuses: ["running", "waiting_action_approval"],
      event: {
        event: "action_approval_requested",
        payload: {
          approvalId: action.approvalId,
          stepId: action.stepId,
          tool: action.tool,
          args: action.args,
        },
      },
    },
  );
}

export interface DecideActionInput {
  runId: string;
  actorUserId: string;
  isRoot: boolean;
  approvalId: string;
  decision: "approve" | "reject";
  feedback?: string;
}

/** 对动作审批表态。拒绝会永久记指纹，任何后续计划都不能再执行同一动作。 */
export async function decideActionApproval(
  input: DecideActionInput,
): Promise<{ row: WorkRunRow; idempotent: boolean; fingerprint: string }> {
  let idempotent = false;
  let fingerprint = "";
  const row = await mutateWorkRun(
    input.runId,
    input.actorUserId,
    input.isRoot,
    (meta) => {
      if (meta.approvals[input.approvalId]) {
        idempotent = true;
        return;
      }
      const pending = meta.artifacts[`pending_action:${input.approvalId}`] as
        | (PendingAction & { fingerprint: string })
        | undefined;
      if (!pending) {
        throw new WorkRunStoreError(
          "not_found",
          `待审批动作不存在: ${input.approvalId}`,
        );
      }
      fingerprint = pending.fingerprint;

      const record: ApprovalRecord = {
        approvalId: input.approvalId,
        scope: "action",
        planVersion: pending.planVersion,
        stepId: pending.stepId,
        tool: pending.tool,
        args: pending.args,
        fingerprint,
        decision: input.decision,
        decidedBy: input.actorUserId,
        decidedAt: Date.now(),
        feedback: input.feedback,
      };
      meta.approvals[input.approvalId] = record;
      delete meta.artifacts[`pending_action:${input.approvalId}`];

      const step = meta.stepResults[pending.stepId];
      if (step) {
        step.status =
          input.decision === "approve" ? "running" : "action_rejected";
        step.approvalId = input.approvalId;
      }
      if (input.decision === "reject") {
        if (!meta.deniedActionFingerprints.includes(fingerprint)) {
          meta.deniedActionFingerprints.push(fingerprint);
        }
      }
    },
    {
      status: input.decision === "approve" ? "running" : "running",
      allowedStatuses: ["waiting_action_approval", "running"],
      event: {
        event: `action_${input.decision}`,
        payload: {
          approvalId: input.approvalId,
          tool: undefined,
          feedback: input.feedback,
        },
      },
    },
  );
  return { row, idempotent, fingerprint };
}

/** 动作是否已被拒绝过（跨计划版本）。 */
export function isActionDenied(
  meta: WorkRunMeta,
  tool: string,
  args: Record<string, unknown>,
): boolean {
  return meta.deniedActionFingerprints.includes(actionFingerprint(tool, args));
}

/** 动作是否已被批准过（幂等执行）。 */
export function findActionApproval(
  meta: WorkRunMeta,
  tool: string,
  args: Record<string, unknown>,
): ApprovalRecord | undefined {
  const fp = actionFingerprint(tool, args);
  return Object.values(meta.approvals).find(
    (a) =>
      a.scope === "action" && a.fingerprint === fp && a.decision === "approve",
  );
}

// ============================================================================
// 步骤结果
// ============================================================================

export async function recordStepResult(
  runId: string,
  actorUserId: string,
  isRoot: boolean,
  step: StepRecord,
  options: { status?: WorkRunStatus; event?: string } = {},
): Promise<void> {
  await mutateWorkRun(
    runId,
    actorUserId,
    isRoot,
    (meta) => {
      meta.stepResults[step.stepId] = step;
      if (step.sideEffectCommitted) {
        meta.artifacts[`side_effect:${step.planVersion}:${step.stepId}`] = {
          committedAt: Date.now(),
          tool: step.result,
        };
      }
    },
    {
      status: options.status,
      event: {
        event: options.event ?? `step_${step.status}`,
        payload: {
          stepId: step.stepId,
          planVersion: step.planVersion,
          error: step.error,
        },
      },
    },
  );
}

/** 崩溃恢复：把 running/waiting_action_approval 的 run 恢复到安全状态。 */
export async function reconcileOnRecovery(
  runId: string,
  actorUserId: string,
  isRoot: boolean,
): Promise<WorkRunRow> {
  return mutateWorkRun(
    runId,
    actorUserId,
    isRoot,
    (meta) => {
      for (const step of Object.values(meta.stepResults)) {
        if (step.status === "running") {
          // 副作用是否已落地未知 —— 不自动重放，等人确认。
          step.status = "needs_reconciliation";
          step.error = "进程中断，外部副作用状态未知，需人工确认后继续";
        }
      }
    },
    {
      allowedStatuses: ["running", "waiting_action_approval", "paused"],
      status: "needs_reconciliation",
      event: { event: "recovery_reconciliation", payload: {} },
    },
  );
}

/** 只读投影：给 UI/SSE 用的安全快照。 */
export function projectRun(row: WorkRunRow) {
  const meta = row.metadata;
  const activePlan =
    meta.activePlanVersion !== null
      ? getPlan(meta, meta.activePlanVersion)
      : undefined;
  const latestPlan = getPlan(meta, meta.planVersion);
  return {
    runId: row.id,
    conversationId: row.conversationId ?? null,
    status: row.status,
    title: meta.title,
    userInput: meta.userInput,
    revision: meta.revision,
    planVersion: meta.planVersion,
    activePlanVersion: meta.activePlanVersion,
    plan: activePlan ?? latestPlan ?? null,
    planStatus: (activePlan ?? latestPlan)?.status ?? null,
    steps: Object.values(meta.stepResults),
    decision: meta.decision ?? null,
    evaluation: meta.evaluation ?? null,
    artifacts: meta.artifacts,
    dataScope: meta.dataScope ?? null,
    deniedActionFingerprints: meta.deniedActionFingerprints,
    summary: meta.summary ?? null,
    error: meta.error ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type WorkRunProjection = ReturnType<typeof projectRun>;

// ============================================================================
// 数据权限范围（C1/C7：服务端强制，不靠 prompt）
// ============================================================================

export {
  resolveDataScope,
  scopeWhere,
  ticketScopeWhere,
  type DataScope,
} from "@/features/ai/core/policy/data-scope";
