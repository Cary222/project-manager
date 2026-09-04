/**
 * Work Agent — 主 Graph
 *
 * 这是 Work Agent 的入口点，协调 runtime、workflows 和 tools。
 *
 * 架构：
 * 1. Runtime: planner / approval / lifecycle / scheduler
 * 2. Workflows: weekly-report 等任务模板
 * 3. Tools: 受限的文件和命令工具
 *
 * 使用 LangGraph 的 Command 和 interrupt 实现 HIL。
 *
 * Phase 1: dispatchNode 接入 router，将任务分诊到 workflow 或 coding。
 */

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { registerWorkTools } from "./tools";
import { TemplateMatcher } from "./router/matcher";
import { listWorkflows } from "./workflows/registry";

// ============================================================================
// State Annotation
// ============================================================================

const lastValue = <T>(defaultFn: () => T) =>
  Annotation<T>({
    value: (current, update) => (update === undefined ? current : update),
    default: defaultFn,
  });

const WorkAgentAnnotation = Annotation.Root({
  // Identity
  runId: lastValue(() => ""),
  userId: lastValue(() => ""),
  userName: lastValue(() => ""),
  sessionId: lastValue(() => ""),

  // Input
  userInput: lastValue(() => ""),

  // Dispatch / Routing
  taskType: lastValue<"workflow" | "coding" | "unknown">(() => "unknown"),
  workflowType: lastValue(() => ""),
  workflowName: lastValue(() => ""),

  // Execution
  steps: lastValue<WorkStep[]>(() => []),
  currentStepIndex: lastValue(() => 0),
  status: lastValue(() => "pending"),

  // HIL
  pendingApproval: lastValue<ApprovalRequest | null>(() => null),
  waitingForHuman: lastValue(() => false),

  // Result
  artifacts: lastValue<Record<string, unknown>>(() => ({})),
  summary: lastValue<string | null>(() => null),
  error: lastValue<string | null>(() => null),

  // Meta
  startedAt: lastValue(() => 0),
  updatedAt: lastValue(() => 0),
});

type WorkAgentState = typeof WorkAgentAnnotation.State;

interface WorkStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
}

interface ApprovalRequest {
  title: string;
  description: string;
  candidates?: { id: string; label: string }[];
}

// ============================================================================
// Agent Entry Point
// ============================================================================

/**
 * Initialize the Work Agent.
 * Must be called before first use.
 */
export function initializeWorkAgent(): void {
  registerWorkTools();
}

// ============================================================================
// CODING_KEYWORDS — 用于 coding 类任务检测
// ============================================================================

const CODING_KEYWORDS = [
  "重构",
  "refactor",
  "修复",
  "fix",
  "bug",
  "代码",
  "code",
  "实现",
  "implement",
  "新增",
  "add feature",
  "功能",
  "测试",
  "test",
  "单元测试",
  "接口",
  "api",
  "模块",
  "读取",
  "read",
  "写入",
  "write",
  "创建",
  "create",
  "删除",
  "delete",
  "文件",
  "file",
  "package.json",
  "查看",
  "检查",
  "check",
  "修改",
  "modify",
  "更新",
  "update",
  "编辑",
  "edit",
];

function isCodingTask(input: string): boolean {
  const lower = input.toLowerCase();
  return CODING_KEYWORDS.some((kw) => lower.includes(kw));
}

// ============================================================================
// Nodes
// ============================================================================

/**
 * Execute coding node: 启动 Pi session 运行 coding 任务。
 *
 * Phase 2: 启动 Pi session，返回 handle（不处理完整事件流）
 * Phase 3: 接入真实 Pi SDK，返回完整事件流
 */
async function executeCodingNode(
  state: WorkAgentState,
): Promise<Partial<WorkAgentState>> {
  const { runId, userInput } = state;

  try {
    // 1. 导入 PiSubAgent
    const { getPiSubAgent } = await import("./subagents/pi/subagent");
    const piAgent = getPiSubAgent();

    // 2. 创建 SubAgentRun
    const subAgentRun = {
      runId: `pi-${runId}`,
      agentType: "pi" as const,
      workspaceId: process.cwd(),
      sessionId: "",
      status: "pending" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 3. 创建 SubAgentInput
    const subAgentInput = {
      prompt: userInput,
      workspace: process.cwd(),
      contextFiles: [],
      userId: state.userId, // 传递 userId 到 Pi Runtime
    };

    // 4. 启动 Pi session（Phase 2: mock）
    const handle = await piAgent.start(subAgentRun, subAgentInput);

    // 5. 返回 running 状态（Phase 2: 不等待完整事件流）
    return {
      status: "running",
      artifacts: {
        piSessionId: handle.sessionId,
        piRunId: handle.runId,
      },
      summary: `Pi Coding Session 已启动 (${handle.sessionId})`,
      updatedAt: Date.now(),
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Pi session 启动失败",
      updatedAt: Date.now(),
    };
  }
}

/**
 * Dispatch node: 任务分诊。
 * - 检测用户输入意图，路由到 workflow 或 coding。
 * - Phase 1: coding 类返回提示，workflow 类路由到对应 graph。
 */
async function dispatchNode(
  state: WorkAgentState,
): Promise<Partial<WorkAgentState>> {
  const input = state.userInput;

  // Step 1: 尝试 workflow 路由（关键词匹配）
  const templates = listWorkflows();
  const matcher = new TemplateMatcher(templates);
  const matchResult = await matcher.match(input);

  if (matchResult.workflowId && matchResult.confidence >= 0.8) {
    return {
      taskType: "workflow",
      workflowType: matchResult.workflowId,
      workflowName:
        templates.find((t) => t.type === matchResult.workflowId)?.name ??
        matchResult.workflowId,
      status: "dispatched",
      updatedAt: Date.now(),
    };
  }

  // Step 2: 检测 coding 类任务（Phase 1: 暂时占位）
  if (isCodingTask(input)) {
    return {
      taskType: "coding",
      status: "pi_pending",
      summary: "Pi Coding Runtime 接入中，该功能将在 Phase 2 上线。",
      updatedAt: Date.now(),
    };
  }

  // Step 3: 无法识别的任务类型
  return {
    taskType: "unknown",
    status: "failed",
    error: `无法识别任务类型: "${input}"，请尝试更具体的描述。`,
    updatedAt: Date.now(),
  };
}

/**
 * Execute workflow node: 运行对应的 workflow graph。
 */
async function executeWorkflowNode(
  state: WorkAgentState,
): Promise<Partial<WorkAgentState>> {
  const { workflowType, userId, runId } = state;

  try {
    // Phase 1: Only weekly_report is supported
    if (workflowType !== "weekly_report") {
      return {
        status: "failed",
        error: `未知工作流类型: ${workflowType}`,
        updatedAt: Date.now(),
      };
    }

    // Get weekly report graph
    const { getWeeklyReportGraph } = await import(
      "./workflows/weekly-report/graph"
    );
    const workflowGraph = await getWeeklyReportGraph();

    // Prepare workflow input (adapt from Work Agent state)
    const workflowInput = {
      userId,
      threadId: runId,
      status: "collecting" as const,
    };

    // Invoke workflow graph (this will block until completion or interrupt)
    const result = await workflowGraph.invoke(workflowInput, {
      configurable: {
        thread_id: runId,
      },
    });

    // Map workflow status to Work Agent status
    if (result.status === "done") {
      return {
        status: "completed",
        artifacts: { reportId: result.reportId },
        summary: result.reportId
          ? `周报已生成（ID: ${result.reportId}）`
          : "工作流已完成",
        updatedAt: Date.now(),
      };
    } else if (result.status === "cancelled") {
      return {
        status: "failed",
        error: "工作流已取消",
        updatedAt: Date.now(),
      };
    } else if (result.error) {
      return {
        status: "failed",
        error: result.error,
        updatedAt: Date.now(),
      };
    } else if (result.status === "waiting_review") {
      // Workflow interrupted for HIL
      return {
        status: "waiting_approval",
        waitingForHuman: true,
        pendingApproval: {
          title: "周报审批",
          description:
            result.draft?.highlights?.join(", ") ??
            result.draft?.rawMarkdown?.slice(0, 100) ??
            "请审阅周报草稿",
        },
        updatedAt: Date.now(),
      };
    }

    // Default: still executing
    return {
      status: "executing",
      updatedAt: Date.now(),
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      updatedAt: Date.now(),
    };
  }
}

/**
 * Approval node: request human approval.
 */
async function approvalNode(): Promise<Partial<WorkAgentState>> {
  // This will be replaced with actual interrupt() call
  return {
    status: "waiting_approval",
    waitingForHuman: true,
    pendingApproval: {
      title: "待审批",
      description: "请审阅并决定是否继续",
    },
    updatedAt: Date.now(),
  };
}

/**
 * Finish node: complete the workflow.
 */
async function finishNode(): Promise<Partial<WorkAgentState>> {
  return {
    status: "completed",
    waitingForHuman: false,
    summary: "任务已完成",
    updatedAt: Date.now(),
  };
}

/**
 * Fail node: handle errors.
 */
async function failNode(
  state: WorkAgentState,
): Promise<Partial<WorkAgentState>> {
  return {
    status: "failed",
    waitingForHuman: false,
    error: state.error ?? "未知错误",
    updatedAt: Date.now(),
  };
}

// ============================================================================
// Routing Edges
// ============================================================================

/**
 * After dispatch: route based on taskType.
 * - workflow → executeWorkflow
 * - coding → END; the HTTP SSE route owns the only Pi session lifecycle
 * - unknown / error → END
 *
 * Keeping coding out of the graph prevents a second Pi session from being
 * launched concurrently with handleCodingTask() in /api/ai/work/run.
 */
function routeAfterDispatch(state: WorkAgentState): string {
  if (state.taskType === "workflow" && state.status === "dispatched") {
    return "executeWorkflow";
  }
  return END;
}

/**
 * After executeWorkflow: check for errors or completion.
 */
function routeAfterWorkflow(state: WorkAgentState): string {
  if (state.status === "failed") return "fail";
  if (state.waitingForHuman) return "approval";
  return "finish";
}

// ============================================================================
// Graph Builder
// ============================================================================

let _graph: ReturnType<typeof buildWorkAgentGraph> | null = null;

function buildWorkAgentGraph() {
  const graph = new StateGraph(WorkAgentAnnotation)
    .addNode("dispatch", dispatchNode)
    .addNode("executeWorkflow", executeWorkflowNode)
    .addNode("executeCoding", executeCodingNode)
    .addNode("approval", approvalNode)
    .addNode("finish", finishNode)
    .addNode("fail", failNode)
    .addEdge(START, "dispatch")
    .addConditionalEdges("dispatch", routeAfterDispatch, {
      executeWorkflow: "executeWorkflow",
      executeCoding: "executeCoding",
      [END]: END,
    })
    .addConditionalEdges("executeWorkflow", routeAfterWorkflow, {
      fail: "fail",
      approval: "approval",
      finish: "finish",
    })
    .addEdge("executeCoding", "finish")
    .addEdge("approval", "executeWorkflow")
    .addEdge("finish", END)
    .addEdge("fail", END);

  return graph.compile();
}

/**
 * Get (or lazily build) the Work Agent compiled graph.
 */
export function getWorkAgentGraph() {
  if (!_graph) {
    _graph = buildWorkAgentGraph();
  }
  return _graph;
}

// ============================================================================
// Export
// ============================================================================

export { WorkAgentAnnotation, type WorkAgentState };
