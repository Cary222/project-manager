/**
 * Shared Capability Registry — Chat/Work 共用的工具与能力元数据。
 *
 * 单一真相源：工具名、schema、风险等级、可用 agentType 全部在这里定义。
 * - validate.ts (Work planner critic) 从这里导入目录做白名单校验
 * - decision.ts (Work LLM decision) 从这里生成 prompt 用的能力清单
 * - Chat 路由未来可查询此处判断是否应 handoff 给 Work
 * - tool-registry.ts (runtime) 运行期注册仍独立，这里只管元数据
 *
 * 设计原则：
 * - 增删工具只改这一处，prompt/validator/权限全自动跟进
 * - 不含运行期 execute 函数 — 那是各 runtime 的事
 * - sideEffect=true 的工具自动标记需 ActionApproval
 */

import { z } from "zod";

// ============================================================================
// 类型
// ============================================================================

export type ToolKind = "read" | "write" | "execute" | "report";

export type AgentType = "WORK" | "CONVERSATION";

export interface CapabilitySpec {
  id?: string;
  name: string;
  description: string;
  kind: ToolKind;
  /** true = 有外部副作用，Work 执行前必须单独 Action Approval (C6)。 */
  sideEffect: boolean;
  scope?: "read" | "action";
  risk?: "low" | "medium" | "high";
  args: z.ZodTypeAny;
  /** UI 展示给审批人的一句话风险说明。 */
  riskNote?: string;
  /** 哪些 Agent 可以使用此工具。 */
  availableIn: AgentType[];
}

// ============================================================================
// 参数 Schema（从 validate.ts 提取，此处为唯一定义）
// ============================================================================

const TICKET_STATUSES = [
  "DEVELOPING",
  "READY_FOR_TEST",
  "DONE",
  "DELIVERED",
  "OVERDUE",
  "CLOSED",
] as const;

export const businessQueryArgs = z
  .object({
    entity: z.enum([
      "project",
      "ticket",
      "ticket_status_history",
      "meeting",
      "commit",
      "weekly_report",
    ]),
    projectId: z.string().max(64).optional(),
    status: z.array(z.enum(TICKET_STATUSES)).max(6).optional(),
    historyStatus: z.enum(TICKET_STATUSES).optional(),
    since: z.string().max(40).optional(),
    until: z.string().max(40).optional(),
    monthOffset: z.number().int().min(0).max(120).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .refine(
    (v) =>
      v.monthOffset === undefined ||
      (v.since === undefined && v.until === undefined),
    {
      message: "monthOffset 与 since/until 互斥，只能给一种时间范围",
    },
  );

export const businessReportArgs = z.object({
  title: z.string().min(1).max(200),
  question: z.string().min(1).max(1000),
  sourceStepIds: z.array(z.string()).min(1).max(10),
  format: z.enum(["markdown", "json"]).optional(),
});

export const generateTextArgs = z.object({
  instruction: z.string().min(1).max(4000),
  sourceStepIds: z.array(z.string()).max(10).optional(),
});

export const readResourceArgs = z.object({
  path: z.string().min(1).max(500),
});

export const writeFileArgs = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(200_000),
});

export const editFileArgs = z.object({
  path: z.string().min(1).max(500),
  oldText: z.string().min(1),
  newText: z.string(),
});

export const executeCommandArgs = z.object({
  command: z.string().min(1).max(2000),
  cwd: z.string().max(500).optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
});

export const executeCodingArgs = z.object({
  prompt: z.string().min(1).max(4000),
  cwd: z.string().max(500).optional(),
  model: z.string().optional(),
});

export const searchKnowledgeArgs = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(50).optional(),
});

export const webSearchArgs = z.object({
  query: z.string().min(1).max(500),
});

// ============================================================================
// 统一工具目录
// ============================================================================

export const CAPABILITY_CATALOG: CapabilitySpec[] = [
  {
    name: "business_query",
    description:
      "查询项目/工单/会议/Git提交/周报等结构化业务数据（服务端强制数据权限，只读）",
    kind: "read",
    sideEffect: false,
    args: businessQueryArgs,
    availableIn: ["WORK"],
  },
  {
    name: "business_report",
    description:
      "基于上游步骤产出结构化复盘/归因报告，必须带来源、扫描计数与截断标记",
    kind: "report",
    sideEffect: false,
    args: businessReportArgs,
    riskNote: "报告仅写入本次任务产物，不对外发布",
    availableIn: ["WORK"],
  },
  {
    name: "generate_text",
    description: "调用 LLM 基于上游步骤结果生成分析文本（只读，无外部副作用）",
    kind: "read",
    sideEffect: false,
    args: generateTextArgs,
    availableIn: ["WORK"],
  },
  {
    name: "read_resource",
    description: "读取仓库内文件/资源内容（只读）",
    kind: "read",
    sideEffect: false,
    args: readResourceArgs,
    availableIn: ["WORK"],
  },
  {
    name: "write_file",
    description: "写入文件（有副作用：修改工作区）",
    kind: "write",
    sideEffect: true,
    args: writeFileArgs,
    riskNote: "会覆盖目标文件内容，需单独批准",
    availableIn: ["WORK"],
  },
  {
    name: "edit_file",
    description: "精确编辑已有文件片段（有副作用：修改工作区）",
    kind: "write",
    sideEffect: true,
    args: editFileArgs,
    riskNote: "会修改目标文件，需单独批准",
    availableIn: ["WORK"],
  },
  {
    name: "execute_command",
    description: "执行受策略网关限制的系统命令（有副作用：可能不可逆）",
    kind: "execute",
    sideEffect: true,
    args: executeCommandArgs,
    riskNote: "会执行系统命令，可能产生不可逆外部副作用，需单独批准",
    availableIn: ["WORK"],
  },
  {
    id: "coding.execute",
    name: "execute_coding",
    description: "调用 Pi Coding 会话修改仓库代码或执行复杂调试（有副作用）",
    kind: "execute",
    sideEffect: true,
    scope: "action",
    risk: "high",
    args: executeCodingArgs,
    riskNote: "会在工作区执行代码变更或系统脚本，需单独批准",
    availableIn: ["WORK"],
  },
  {
    id: "knowledge.search",
    name: "search_knowledge",
    description: "知识库混合向量检索与图谱展开，用于知识问答与背景检索（只读）",
    kind: "read",
    sideEffect: false,
    scope: "read",
    risk: "low",
    args: searchKnowledgeArgs,
    availableIn: ["CONVERSATION", "WORK"],
  },
  {
    id: "web.search",
    name: "web_search",
    description: "外部互联网实时搜索，用于获取外部技术文档与公开常识（只读）",
    kind: "read",
    sideEffect: false,
    scope: "read",
    risk: "low",
    args: webSearchArgs,
    availableIn: ["CONVERSATION", "WORK"],
  },
];

// ============================================================================
// 查询 API
// ============================================================================

const _byName = new Map<string, CapabilitySpec>();
for (const c of CAPABILITY_CATALOG) {
  _byName.set(c.name, c);
  if (c.id) _byName.set(c.id, c);
}
/** 按名称查工具规格。 */
export function getCapability(name: string): CapabilitySpec | undefined {
  return _byName.get(name);
}

/** 按 agentType 过滤可用工具列表。 */
export function getCapabilitiesForAgent(
  agentType: AgentType,
): CapabilitySpec[] {
  return CAPABILITY_CATALOG.filter((c) => c.availableIn.includes(agentType));
}

/** 所有有副作用的工具名（需 ActionApproval）。 */
export function getSideEffectToolNames(): string[] {
  return CAPABILITY_CATALOG.filter((c) => c.sideEffect).map((c) => c.name);
}

/**
 * 给 planner prompt 用的工具清单 — 从目录生成，避免宣传幻觉工具。
 * 与 validate.ts 的 toolCatalogPrompt() 语义一致，此处为统一入口。
 */
export function capabilityCatalogPrompt(agentType: AgentType = "WORK"): string {
  return getCapabilitiesForAgent(agentType)
    .map((c) => {
      const effect = c.sideEffect ? "【有副作用，需单独动作审批】" : "";
      return `- ${c.name}: ${c.description}${effect}`;
    })
    .join("\n");
}
