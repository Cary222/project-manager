import { describe, expect, it } from "vitest";
import {
  actionFingerprint,
  emptyMeta,
  findActionApproval,
  isActionDenied,
  parseMeta,
  projectRun,
  type ApprovalRecord,
  type PlanRecord,
  type ValidatedStep,
  type WorkRunRow,
} from "./work-run-store";

function step(id: string, over: Partial<ValidatedStep> = {}): ValidatedStep {
  return {
    id,
    action: "a",
    description: "d",
    tool: "generate_text",
    args: { instruction: "x" },
    dependsOn: [],
    requiresActionApproval: false,
    ...over,
  };
}

function plan(version: number, status: PlanRecord["status"]): PlanRecord {
  return {
    version,
    title: `v${version}`,
    goal: "g",
    steps: [step("s1")],
    createdAt: 0,
    createdBy: "u",
    status,
    validation: { ok: true, errors: [] },
    origin: { kind: "initial" },
  };
}

function approval(over: Partial<ApprovalRecord>): ApprovalRecord {
  return {
    approvalId: "a1",
    scope: "action",
    planVersion: 1,
    fingerprint: "fp",
    decision: "approve",
    decidedBy: "u",
    decidedAt: 0,
    ...over,
  };
}

// ============================================================================

describe("actionFingerprint（拒绝绕过防线的基础）", () => {
  it("参数键顺序不同但语义相同 → 同一指纹", () => {
    // 若这里不稳定，用户拒绝后 agent 只要重排参数键就能绕过拒绝。
    expect(actionFingerprint("write_file", { b: 1, a: 2 })).toBe(
      actionFingerprint("write_file", { a: 2, b: 1 }),
    );
  });

  it("嵌套对象的键顺序也被稳定化", () => {
    expect(actionFingerprint("t", { x: { b: 1, a: 2 } })).toBe(
      actionFingerprint("t", { x: { a: 2, b: 1 } }),
    );
  });

  it("工具不同 → 指纹不同", () => {
    expect(actionFingerprint("a", {})).not.toBe(actionFingerprint("b", {}));
  });

  it("参数值不同 → 指纹不同", () => {
    expect(actionFingerprint("t", { p: "x" })).not.toBe(
      actionFingerprint("t", { p: "y" }),
    );
  });

  it("数组顺序敏感：顺序不同视为不同操作", () => {
    expect(actionFingerprint("t", { a: [1, 2] })).not.toBe(
      actionFingerprint("t", { a: [2, 1] }),
    );
  });

  it("null 与字符串不是同一指纹", () => {
    expect(actionFingerprint("t", { p: null })).not.toBe(
      actionFingerprint("t", { p: "null" }),
    );
  });
});

describe("isActionDenied（拒绝不可绕过）", () => {
  it("指纹已记录 → 判为已拒绝", () => {
    const meta = emptyMeta("t", "u");
    meta.deniedActionFingerprints.push(
      actionFingerprint("execute_command", { command: "rm -rf build" }),
    );
    expect(
      isActionDenied(meta, "execute_command", { command: "rm -rf build" }),
    ).toBe(true);
  });

  it("键顺序微调不能绕过拒绝", () => {
    const meta = emptyMeta("t", "u");
    meta.deniedActionFingerprints.push(
      actionFingerprint("write_file", { path: "a", content: "b" }),
    );
    expect(
      isActionDenied(meta, "write_file", { content: "b", path: "a" }),
    ).toBe(true);
  });

  it("参数真的不同则不算被拒（避免误封）", () => {
    const meta = emptyMeta("t", "u");
    meta.deniedActionFingerprints.push(
      actionFingerprint("write_file", { path: "a" }),
    );
    expect(isActionDenied(meta, "write_file", { path: "b" })).toBe(false);
  });
});

describe("findActionApproval（幂等执行依据）", () => {
  it("approve 的动作算已批准", () => {
    const meta = emptyMeta("t", "u");
    const fp = actionFingerprint("write_file", { path: "a" });
    meta.approvals.a1 = approval({ fingerprint: fp, decision: "approve" });
    expect(findActionApproval(meta, "write_file", { path: "a" })).toBeDefined();
  });

  it("reject 的动作绝不算已批准", () => {
    const meta = emptyMeta("t", "u");
    const fp = actionFingerprint("write_file", { path: "a" });
    meta.approvals.a1 = approval({ fingerprint: fp, decision: "reject" });
    expect(
      findActionApproval(meta, "write_file", { path: "a" }),
    ).toBeUndefined();
  });

  it("计划层审批不会当作动作审批", () => {
    const meta = emptyMeta("t", "u");
    const fp = actionFingerprint("write_file", { path: "a" });
    meta.approvals.a1 = approval({ fingerprint: fp, scope: "plan" });
    expect(
      findActionApproval(meta, "write_file", { path: "a" }),
    ).toBeUndefined();
  });
});

describe("parseMeta（脏数据容错，绝不抛）", () => {
  it("null → 返回带默认值的 meta", () => {
    const m = parseMeta(null, "兜底标题");
    expect(m.title).toBe("兜底标题");
    expect(m.revision).toBe(0);
    expect(m.plans).toEqual({});
    expect(m.deniedActionFingerprints).toEqual([]);
  });

  it("非对象（字符串/数字）也不抛", () => {
    expect(() => parseMeta("garbage")).not.toThrow();
    expect(() => parseMeta(42)).not.toThrow();
  });

  it("字段类型错乱时用默认值替换，不传播脏类型", () => {
    const m = parseMeta({
      revision: "not-a-number",
      plans: "not-an-object",
      deniedActionFingerprints: "nope",
      maxReplans: null,
    });
    expect(m.revision).toBe(0);
    expect(m.plans).toEqual({});
    expect(m.deniedActionFingerprints).toEqual([]);
    expect(m.maxReplans).toBe(3);
  });

  it("正常数据被完整保留", () => {
    const orig = emptyMeta("标题", "输入");
    orig.revision = 7;
    orig.replanCount = 2;
    orig.plans["1"] = plan(1, "approved");
    const m = parseMeta(JSON.parse(JSON.stringify(orig)));
    expect(m.revision).toBe(7);
    expect(m.replanCount).toBe(2);
    expect(m.plans["1"].status).toBe("approved");
    expect(m.title).toBe("标题");
  });
});

describe("projectRun（UI 只读投影）", () => {
  function row(meta: Partial<WorkRunRow["metadata"]>): WorkRunRow {
    return {
      id: "r1",
      userId: "u1",
      status: "running",
      workflowType: "planning",
      metadata: { ...emptyMeta("T", "I"), ...meta },
      history: [],
      updatedAt: new Date(0),
    };
  }

  it("优先展示 activePlanVersion，而不是最新版本", () => {
    const meta = emptyMeta("T", "I");
    meta.planVersion = 2;
    meta.activePlanVersion = 1;
    meta.plans["1"] = plan(1, "executing");
    meta.plans["2"] = plan(2, "pending_approval");
    const p = projectRun(row(meta));
    expect(p.plan?.version).toBe(1);
    expect(p.planStatus).toBe("executing");
  });

  it("没有 active 计划时退回最新版本", () => {
    const meta = emptyMeta("T", "I");
    meta.planVersion = 2;
    meta.activePlanVersion = null;
    meta.plans["2"] = plan(2, "pending_approval");
    const p = projectRun(row(meta));
    expect(p.plan?.version).toBe(2);
    expect(p.planStatus).toBe("pending_approval");
  });

  it("没有任何计划时不抛，plan 为 null", () => {
    const p = projectRun(row({}));
    expect(p.plan).toBeNull();
    expect(p.planStatus).toBeNull();
  });

  it("投影暴露拒绝指纹，UI 可据此解释为何某操作被拦", () => {
    const meta = emptyMeta("T", "I");
    meta.deniedActionFingerprints.push("write_file:{}");
    expect(projectRun(row(meta)).deniedActionFingerprints).toEqual([
      "write_file:{}",
    ]);
  });
});
