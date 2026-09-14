"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  type WorkRoute,
  type WorkRunRef,
} from "@/features/ai/agents/work/runtime/work-run-ref";
import { WorkflowLauncher, type CodingCommand } from "./WorkflowLauncher";
import { WorkflowStatus } from "./WorkflowStatus";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { MeetingMinutesWorkflow } from "./MeetingMinutesWorkflow";
import { ModelSelector } from "@/features/ai/llm/model-selector";
import { ALL_PI_CAPABILITIES, type PiCommandKey, type RoutePreflightResult } from "@/features/ai/agents/work/router/route-types";
import { IconX } from "@/shared/ui/icons";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowRun {
  id: string;
  kind: string;
  workflowType: string;
  status: string;
  threadId: string | null;
  conversationId?: string | null;
  metadata: unknown;
  history: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface WorkItem {
  id: string;
  kind: WorkRoute;
  source: "WorkflowRun" | "ProjectMeeting" | "PiSessionOwnership";
  sourceId: string;
  status: string;
  title: string;
  updatedAt: string;
  projectId?: string;
  conversationId?: string | null;
  metadata?: unknown;
}

interface WorkAgentRunResult {
  runId: string;
  status: string;
  taskType: "workflow" | "coding" | "planning" | "unknown";
  steps?: Array<{ id: string; action: string; description: string; tool?: string; dependsOn: string[] }>;
  workflowType?: string;
  workflowName?: string;
  summary?: string | null;
  error?: string | null;
  piOutput?: string;
}

interface SSERecord {
  id: number;
  type: string;
  payload: unknown;
  timestamp: number;
}

// ─── Route labels ──────────────────────────────────────────────────────────────

/** 未显式点选时的展示文案：由服务端决策，前端不预判。 */
const AUTO_ROUTE_LABEL = "由服务端决策";
const AUTO_ROUTE_DESC =
  "将根据目标语义自动决定执行策略（固定模板 / 动态规划 / 单步执行 / 先澄清）";

const routeLabels: Record<WorkRoute, string> = {
  project_progress: "项目进展汇总",
  weekly_report: "周报生成",
  meeting_minutes: "会议纪要",
  coding: "Coding Task",
  planning: "自主规划",
};

const routeDescriptions: Record<WorkRoute, string> = {
  weekly_report: "汇总本周工单、提交和进度，生成结构化周报",
  meeting_minutes: "上传录音文件 → 转写 → 摘要 → 审核发布",
  project_progress: "聚合项目维度的工单/Git/知识库数据，生成汇总报告",
  coding: "创建 Pi Session 执行代码变更，Diff 和测试结果可审核",
  planning: "由 LLM 自主拆解多步执行方案并生成审批卡片，经人工确认后推进",
};

const codingCommandOptions: Array<{
  value: CodingCommand;
  label: string;
  command: string;
  description: string;
  preview: boolean;
}> = [
  {
    value: "goal",
    label: "执行目标",
    command: "/goal",
    description: "直接进入受控开发执行；写入/高风险工具会要求审批。",
    preview: false,
  },
  {
    value: "plan",
    label: "先做计划",
    command: "/plan",
    description: "仅分析仓库并产出可审阅实施计划，不修改文件。",
    preview: true,
  },
  {
    value: "audit",
    label: "代码审查",
    command: "/audit",
    description: "先审查目标范围并给出问题、风险和修复建议。",
    preview: true,
  },
  {
    value: "reach",
    label: "影响分析",
    command: "/reach",
    description: "先梳理目标改动的依赖、影响范围和验证路径。",
    preview: true,
  },
  {
    value: "websearch",
    label: "资料检索",
    command: "/websearch",
    description: "先检索与目标相关的外部资料，再将结论带回会话。",
    preview: true,
  },
];

// ─── Props ─────────────────────────────────────────────────────────────────────

interface WorkDashboardProps {
  /** 切换到对话模式 */
  onSwitchToConversation?: () => void;
  /** 外部传入的初始需求 */
  initialGoal?: string;
  /** 外部传入的目标工作流路由 */
  initialRoute?: WorkRoute | null;
  /** 预览/工作流面板是否展开（支持折叠） */
  previewPanelOpen?: boolean;
  /** 切换工作流预览面板折叠 */
  onTogglePreviewPanel?: () => void;
  /** 当前关联的对话 ID */
  conversationId?: string;
  /** 当创建或关联了对话时回调（同步到 AiChatPage 的 activeConversationId） */
  onConversationCreated?: (conversationId: string) => void;
  /** 自定义插槽渲染：将 mainPanel 与 previewPanel 注入三面板布局 */
  children?: (slots: { mainPanel: ReactNode; previewPanel: ReactNode }) => ReactNode;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function WorkDashboard({
  onSwitchToConversation,
  initialGoal,
  initialRoute,
  previewPanelOpen = true,
  onTogglePreviewPanel,
  conversationId,
  onConversationCreated,
  children,
}: WorkDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(
    () => conversationId ?? null,
  );
  useEffect(() => {
    if (conversationId) setCurrentConversationId(conversationId);
  }, [conversationId]);

  const queryGoal = searchParams?.get("goal") ?? "";
  const queryRoute = (searchParams?.get("route") as WorkRoute) || null;

  const defaultGoal = initialGoal ?? queryGoal;
  const defaultRoute = initialRoute ?? queryRoute;

  // -- 任务与工作流列表 --
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // -- 模型配置 (继承 chat/用户偏好并支持 work 独立持久化) --
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem("preferredModel_work") ||
        localStorage.getItem("preferredModel_chat") ||
        localStorage.getItem("preferredModel") ||
        "agnes:agnes-2.5-flash"
      );
    }
    return "agnes:agnes-2.5-flash";
  });

  // -- 侧边栏滚动与输入框聚焦 --
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const goalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const [codingCommand, setCodingCommand] = useState<CodingCommand>("goal");

  // -- 显式路由锁定与分诊状态 --
  const [selectedRouteOverride, setSelectedRouteOverride] = useState<WorkRoute | null>(
    () => defaultRoute ?? null,
  );

  const handleSelectPresetGoal = useCallback(
    (preset: string, command: CodingCommand = "goal", targetRoute?: WorkRoute) => {
      setGoalInput(preset);
      setCodingCommand(command);
      if (targetRoute) {
        setSelectedRouteOverride(targetRoute);
      }
      sidebarScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => {
        goalTextareaRef.current?.focus();
        goalTextareaRef.current?.select();
      }, 120);
    },
    [],
  );

  // -- Goal 输入 --
  const [goalInput, setGoalInput] = useState<string>(() => defaultGoal ?? "");
  //
  // 这里**不再**用正则预判业务走向。未显式点选时 route="auto"，
  // 表示"交给服务端 Decision 决定"，UI 只如实显示这个状态，
  // 不假装已经知道该走周报还是项目进展。
  const route: WorkRoute | "auto" = selectedRouteOverride ?? "auto";

  // 当从 Chat 模式切换到 Work 模式并带入新的 goal/route 时，自动预填并高亮聚焦
  useEffect(() => {
    const nextGoal = initialGoal ?? searchParams?.get("goal");
    const nextRoute = initialRoute ?? (searchParams?.get("route") as WorkRoute | null);
    if (nextGoal) {
      setGoalInput(nextGoal);
      setTimeout(() => {
        sidebarScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        goalTextareaRef.current?.focus();
        goalTextareaRef.current?.select();
      }, 150);
    }
    if (nextRoute !== undefined && nextRoute !== null) {
      setSelectedRouteOverride(nextRoute);
    }
  }, [initialGoal, initialRoute, searchParams]);

  // -- Work Agent SSE 执行 --
  const [isRunning, setIsRunning] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastResult, setLastResult] = useState<WorkAgentRunResult | null>(null);
  const [realtimeEvents, setRealtimeEvents] = useState<SSERecord[]>([]);
  const [streamStartTime, setStreamStartTime] = useState<number | null>(null);
  const [streamElapsedMs, setStreamElapsedMs] = useState(0);
  const [isThinkingCollapsed, setIsThinkingCollapsed] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);
  const currentRunIdRef = useRef<string>("");

  // -- HIL 审批 --
  /**
   * 待审批项。两层审批必须分开：
   * - scope='plan'   ：批准“走这条路线”，绑定 planVersion
   * - scope='action' ：批准“执行这个具体副作用”，绑定 tool+args 指纹
   * 计划批准不授权副作用 —— 写操作仍会再弹一次动作审批。
   */
  const [pendingApproval, setPendingApproval] = useState<{
    runId: string;
    scope: "plan" | "action";
    /** 幂等键。重复提交同一个 approvalId 不会重复执行。 */
    approvalId: string;
    planVersion?: number;
    /** 动作审批的可读描述；计划审批用 steps 展示。 */
    tool: string;
    args: unknown;
    reason: string;
    steps?: Array<{
      id: string;
      action: string;
      description: string;
      tool: string;
      dependsOn: string[];
      requiresActionApproval: boolean;
      riskNote?: string;
    }>;
  } | null>(null);

  /** 决策理由（C2：用户必须能看到“为什么这么走”）。 */
  const [lastDecision, setLastDecision] = useState<{
    mode: string;
    intent: string;
    reason: string;
    summary: string;
    confidence: number;
    dataScope?: { mode: string; projectCount: number; truncated: boolean };
    unsupportedConcepts?: Array<{ concept: string; why: string; ask: string }>;
    degraded?: string | null;
  } | null>(null);

  /** 澄清请求：信息不足或数据结构无法表达时，停下来问人。 */
  const [clarification, setClarification] = useState<{
    text?: string;
    missingInfo: string[];
    unsupportedConcepts: Array<{ concept: string; why: string; ask: string }>;
  } | null>(null);

  // -- 选中的任务详情 --
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  // 当外部传入或切换 active conversation 时，自动在任务列表中选中匹配项
  useEffect(() => {
    if (currentConversationId && workItems.length > 0) {
      const matched = workItems.find((item) => item.conversationId === currentConversationId);
      if (matched && selectedItem?.id !== matched.id) {
        setSelectedItem(matched);
      }
    }
  }, [currentConversationId, workItems, selectedItem]);

  // -- 周报跳转去重 --
  const NAVIGATED_RUN_IDS_KEY = "pm:navigatedRunIds";
  const navigatedRunIdsRef = useRef<Set<string> | null>(null);
  if (navigatedRunIdsRef.current === null) {
    let initial = new Set<string>();
    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(NAVIGATED_RUN_IDS_KEY);
        if (raw) initial = new Set(JSON.parse(raw) as string[]);
      } catch {
        /* ignore */
      }
    }
    navigatedRunIdsRef.current = initial;
  }

  const recordNavigated = useCallback((runId: string) => {
    const set = navigatedRunIdsRef.current;
    if (!set) return;
    set.add(runId);
    try {
      sessionStorage.setItem(
        NAVIGATED_RUN_IDS_KEY,
        JSON.stringify(Array.from(set)),
      );
    } catch {
      /* ignore */
    }
  }, []);

  // ─── 加载任务与工作流列表 ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        let items: WorkItem[] = [];
        let wfList: WorkflowRun[] = [];

        // 1. 先尝试加载统一的 Work Read Model 投影 (/api/ai/work/runs)
        try {
          const runsRes = await fetch("/api/ai/work/runs");
          if (runsRes.ok) {
            const json = await runsRes.json();
            if (
              json.enabled !== false &&
              Array.isArray(json.data) &&
              json.data.length > 0
            ) {
              items = json.data.map((ref: WorkRunRef) => ({
                id: `${ref.source}-${ref.sourceId}`,
                kind: ref.kind,
                source: ref.source,
                sourceId: ref.sourceId,
                status: ref.status,
                title: ref.title,
                updatedAt: ref.updatedAt,
                projectId:
                  "projectId" in ref
                    ? (ref as { projectId?: string }).projectId
                    : undefined,
                conversationId:
                  "conversationId" in ref
                    ? (ref as { conversationId?: string | null }).conversationId
                    : undefined,
              }));
            }
          }
        } catch {
          /* ignore */
        }

        // 2. 加载 WorkflowRun 列表（用于周报/进展详情和 fallback）
        try {
          const wfRes = await fetch("/api/ai/workflows?kind=RUN&limit=20");
          if (wfRes.ok) {
            const json = await wfRes.json();
            wfList = json.data ?? [];
            if (!cancelled) setWorkflowRuns(wfList);
          }
        } catch {
          /* ignore */
        }

        // 3. 若 /api/ai/work/runs 禁用或为空，回退到 workflow runs 渲染
        if (items.length === 0 && wfList.length > 0) {
          items = wfList.map((wf) => ({
            id: `WorkflowRun-${wf.id}`,
            kind: (wf.workflowType === "project-progress"
              ? "project_progress"
              : "weekly_report") as WorkRoute,
            source: "WorkflowRun",
            sourceId: wf.id,
            status: wf.status,
            title:
              wf.workflowType === "project-progress"
                ? "项目进展汇总"
                : "周报生成",
            updatedAt: wf.updatedAt,
            metadata: wf.metadata,
          }));
        }

        if (!cancelled) {
          setWorkItems(items);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // ─── SSE 事件处理 ────────────────────────────────────────────────────────────

  const handleSSEEvent = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const record: SSERecord = {
        id: eventIdRef.current++,
        type: data.type,
        payload: data.payload,
        timestamp: Date.now(),
      };
      setRealtimeEvents((prev) => [...prev, record].slice(-10));

      if (data.type === "conversation_linked") {
        const payload = data.payload as { conversationId?: string; runId?: string };
        if (payload?.conversationId) {
          setCurrentConversationId(payload.conversationId);
          onConversationCreated?.(payload.conversationId);
        }
      }

      if (data.type === "run_started") {
        const payload = data.payload as { runId?: string };
        if (payload?.runId) {
          currentRunIdRef.current = payload.runId;
          setLastResult((prev) => ({
            runId: payload.runId!,
            status: "running",
            taskType: "unknown",
            ...prev,
          }));
        }
      }
      if (data.type === "pi_assistant_message") {
        const payload = data.payload as {
          assistantMessageEvent?: { content?: string; delta?: string };
        };
        const text =
          payload?.assistantMessageEvent?.content ??
          payload?.assistantMessageEvent?.delta ??
          "";
        if (text) {
          setLastResult((prev) => ({
            ...prev!,
            piOutput: (prev?.piOutput ?? "") + text,
          }));
        }
      }

      if (data.type === "pi_session_started") {
        const payload = data.payload as { piSessionId?: string };
        if (payload?.piSessionId) {
          const codingItem: WorkItem = {
            id: `PiSession-${payload.piSessionId}`,
            kind: "coding",
            source: "PiSessionOwnership",
            sourceId: payload.piSessionId,
            status: "running",
            title: `${codingCommandOptions.find((option) => option.value === codingCommand)?.command ?? "/goal"} ${goalInput.trim()}`.slice(0, 120),
            updatedAt: new Date().toISOString(),
          };
          setLastResult((prev) => ({
            ...prev!,
            runId: payload.piSessionId ?? prev?.runId ?? "",
            status: "running",
            taskType: "coding",
          }));
          setWorkItems((prev) => [codingItem, ...prev.filter((item) => item.id !== codingItem.id)]);
          setSelectedItem(codingItem);
          setRefreshKey((key) => key + 1);
        }
      }

      if (data.type === "pi_approval_required") {
        const payload = data.payload as {
          runId?: string;
          callId?: string;
          tool?: string;
          args?: unknown;
          reason?: string;
        };
        setPendingApproval({
          runId: payload.runId ?? "",
          scope: "action",
          approvalId: payload.callId ?? "",
          tool: payload.tool ?? "",
          args: payload.args ?? {},
          reason: payload.reason ?? "需要用户审批",
        });
      }

      if (data.type === "dispatch_result") {
        const payload = data.payload as {
          taskType?: "workflow" | "coding" | "planning" | "meeting_minutes" | "direct" | "unknown";
          /** 服务端真正启动后返回的 run id（模板路径由模板 runtime 建行）。 */
          runId?: string;
          skipped?: boolean;
          workflowType?: string;
          summary?: string;
          steps?: Array<{ id: string; action: string; description: string; tool?: string; dependsOn: string[] }>;
        };
        if (payload?.taskType === "direct") {
          const runId = currentRunIdRef.current || `direct-${Date.now()}`;
          const directItem: WorkItem = {
            id: `WorkflowRun-${runId}`,
            kind: "planning",
            source: "WorkflowRun",
            sourceId: runId,
            status: "done",
            title: payload.summary?.slice(0, 30) || "直接回复",
            updatedAt: new Date().toISOString(),
          };
          setWorkItems((prev) => [directItem, ...prev.filter((i) => i.id !== directItem.id)]);
          setSelectedItem(directItem);
          setLastResult((prev) => ({
            ...prev!,
            runId,
            taskType: "planning",
            status: "completed",
            summary: payload.summary ?? "回答完成",
          }));
          setIsStreaming(false);
          setIsRunning(false);
          setRefreshKey((k) => k + 1);
        } else if (payload?.taskType === "planning") {
          const planTitle = payload.summary ?? "自主规划任务";
          const runId = currentRunIdRef.current || `plan-${Date.now()}`;
          const planItem: WorkItem = {
            id: `WorkflowRun-${runId}`,
            kind: "planning",
            source: "WorkflowRun",
            sourceId: runId,
            status: "waiting_review",
            title: planTitle,
            updatedAt: new Date().toISOString(),
          };
          setWorkItems((prev) => [planItem, ...prev.filter((i) => i.id !== planItem.id)]);
          setSelectedItem(planItem);
          setLastResult((prev) => ({
            ...prev!,
            runId,
            taskType: "planning",
            status: "planning_ready",
            summary: planTitle,
            steps: payload.steps,
          }));
          setRefreshKey((k) => k + 1);
        } else if (payload?.taskType === "workflow" && payload.workflowType) {
          // 服务端 Decision 判定走固定模板，并已由模板 runtime 真正启动。
          // 前端不再自己 POST /api/ai/workflows —— 这里只如实呈现结果。
          const wfRunId = payload.runId ?? currentRunIdRef.current;
          if (wfRunId) {
            const isWeekly = payload.workflowType === "weekly_report";
            const label = isWeekly ? "周报生成" : "项目进展汇总";
            const item: WorkItem = {
              id: `WorkflowRun-${wfRunId}`,
              kind: isWeekly ? "weekly_report" : "project_progress",
              source: "WorkflowRun",
              sourceId: wfRunId,
              status: payload.skipped ? "skipped" : "running",
              title: label,
              updatedAt: new Date().toISOString(),
            };
            setWorkItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
            setSelectedItem(item);
            setLastResult((prev) => ({
              ...prev!,
              runId: wfRunId,
              taskType: "workflow",
              status: payload.skipped ? "skipped" : "running",
              workflowName: label,
              summary: payload.summary ?? label,
              error: payload.skipped ? "已有相同类型的工作流正在运行" : undefined,
            }));
            setRefreshKey((k) => k + 1);
          }
        } else if (payload?.taskType === "meeting_minutes") {
          // 会议纪要需要录音，服务端只做决策，实际流程在面板内开始
          setSelectedItem({
            id: `new-meeting-${Date.now()}`,
            kind: "meeting_minutes",
            source: "ProjectMeeting",
            sourceId: "",
            status: "UPLOADING",
            title: goalInput.trim() || "新建会议纪要",
            updatedAt: new Date().toISOString(),
          });
        }
      }

      if (data.type === "plan_approval_required") {
        const payload = data.payload as {
          runId?: string;
          approvalId?: string;
          planVersion?: number;
          title?: string;
          goal?: string;
          steps?: Array<{
            id: string;
            action: string;
            description: string;
            tool: string;
            dependsOn: string[];
            requiresActionApproval: boolean;
            riskNote?: string;
          }>;
          requiresActionApproval?: boolean;
        };
        const runId = payload.runId ?? currentRunIdRef.current;
        if (runId) {
          setPendingApproval({
            runId,
            scope: "plan",
            approvalId: payload.approvalId ?? `plan_${runId}_v${payload.planVersion ?? 1}`,
            planVersion: payload.planVersion,
            tool: "Plan",
            args: {},
            reason: `共 ${payload.steps?.length ?? 0} 步${payload.requiresActionApproval ? "（含需单独动作批准的有副作用步骤）" : ""}`,
            steps: payload.steps,
          });
          setClarification(null);
          setLastResult((prev) => ({
            ...prev!,
            runId,
            taskType: "planning",
            status: "waiting_approval",
            summary: payload.title ?? "任务规划待确认",
            steps: payload.steps,
          }));
          setIsStreaming(false);
          setIsRunning(false);
          setRefreshKey((k) => k + 1);
        }
      }

      // 服务端决策结果 —— 用户必须看到“为什么这么走”（C2 可解释性）
      if (data.type === "decision") {
        const payload = data.payload as {
          mode?: string;
          intent?: string;
          reason?: string;
          summary?: string;
          confidence?: number;
          dataScope?: { mode: string; projectCount: number; truncated: boolean };
          unsupportedConcepts?: Array<{ concept: string; why: string; ask: string }>;
          degraded?: string | null;
        };
        setLastDecision({
          mode: payload.mode ?? "unknown",
          intent: payload.intent ?? "",
          reason: payload.reason ?? "",
          summary: payload.summary ?? "",
          confidence: payload.confidence ?? 0,
          dataScope: payload.dataScope,
          unsupportedConcepts: payload.unsupportedConcepts,
          degraded: payload.degraded ?? null,
        });
      }

      // 澄清请求 —— 信息不足或数据结构无法表达，停下来问人而不是猜
      if (data.type === "clarification_required") {
        const payload = data.payload as {
          clarification?: string;
          missingInfo?: string[];
          unsupportedConcepts?: Array<{ concept: string; why: string; ask: string }>;
        };
        setClarification({
          text: payload.clarification,
          missingInfo: payload.missingInfo ?? [],
          unsupportedConcepts: payload.unsupportedConcepts ?? [],
        });
        setIsStreaming(false);
        setIsRunning(false);
      }
      if (data.type === "pi_run_completed") {
        setIsStreaming(false);
        setIsRunning(false);
        setPendingApproval(null);
        let finalText = "";
        const payload = data.payload as {
          message?: { content?: Array<{ text?: string }> };
          runId?: string;
        };
        if (
          payload?.message?.content &&
          Array.isArray(payload.message.content)
        ) {
          finalText = payload.message.content.map((c) => c.text ?? "").join("");
        }
        setLastResult((prev) => ({
          ...prev!,
          runId: payload?.runId ?? prev?.runId ?? "",
          status: "completed",
          summary: prev?.piOutput || finalText || "任务已完成",
          piOutput: prev?.piOutput || finalText,
        }));
        // 刷新列表
        setRefreshKey((k) => k + 1);
      }

      if (data.type === "pi_error") {
        setIsStreaming(false);
        setIsRunning(false);
        setPendingApproval(null);
        const payload = data.payload as { message?: string };
        setLastResult((prev) => ({
          ...prev!,
          status: "failed",
          error: payload.message ?? "未知错误",
        }));
      }
    } catch {
      /* ignore */
    }
  }, [codingCommand, goalInput]);

  // ─── 按路由提交 Goal ─────────────────────────────────────────────────────────

  const submitGoal = useCallback(
    async (overridePrompt?: string, overrideCommand?: string) => {
      const rawInput = (overridePrompt || goalInput).trim();
      if (!rawInput || isRunning) return;
      // ── 业务路由一律交给服务端 Decision，前端不再用正则分叉 ──
      //
      // 这里**刻意不判断** weekly_report / project_progress / meeting_minutes / planning：
      // 关键词判定既判不准复合目标（「统计上月延期工单并出复盘」会被吞成单一流程），
      // 也会让「外部工单」这类数据结构无法表达的筛选条件被静默丢掉，
      // 最终产出一份数字看着合理、语义全错的报告。
      //
      // 服务端 decideWorkStrategy() 决定走 固定模板 / 动态规划 / 单步 / 先澄清，
      // 结果经 SSE 的 decision + dispatch_result 事件回到 handleSSEEvent。
      //
      // 唯一保留的前端输入是 selectedRouteOverride —— 那是用户**显式点选**的流程，
      // 属显式指令而非推断，作为 preferredWorkflow 原样交给服务端校验。

      // ── coding: 走 /api/ai/work/run SSE 流 ──
      const effectiveCommand = (overrideCommand as CodingCommand) || codingCommand;

      // 清理之前的 SSE 资源
      if (readerRef.current) {
        await readerRef.current.cancel().catch(() => {});
        readerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      setIsRunning(true);
      setLastResult(null);
      setRealtimeEvents([]);
      const startMs = Date.now();
      setStreamStartTime(startMs);
      setStreamElapsedMs(0);
      setIsThinkingCollapsed(false);
      eventIdRef.current = 0;

      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const response = await fetch("/api/ai/work/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: rawInput,
            model: selectedModel,
            command: effectiveCommand,
            // 显式点选的流程（无则 auto，交给服务端 Decision）
            preferredWorkflow: selectedRouteOverride ?? "auto",
            conversationId: currentConversationId || undefined,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const json = await response.json();
          setLastResult({
            runId: "",
            status: "failed",
            taskType: "unknown",
            error: json.error ?? "未知错误",
          });
          setIsRunning(false);
          return;
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream")) {
          // SSE 模式（coding 任务）
          setIsStreaming(true);
          const reader = response.body?.getReader();
          if (!reader) throw new Error("无法读取响应流");
          readerRef.current = reader;
          const decoder = new TextDecoder();
          let buffer = "";

          setLastResult({
            runId: "",
            status: "running",
            // 客户端不再预判这是 planning 还是 coding —— 由服务端的
            // decision / dispatch_result 事件回填真实 taskType，先标 unknown 不撒谎。
            taskType: "unknown",
            summary: "已提交，等待服务端决策…",
          });

          const readStream = async () => {
            try {
              while (true) {
                if (abortController.signal.aborted) break;
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                  if (line.startsWith("data: ")) {
                    const jsonStr = line.slice(6);
                    try {
                      JSON.parse(jsonStr);
                      handleSSEEvent({ data: jsonStr } as MessageEvent);
                    } catch {
                      /* ignore */
                    }
                  }
                }
              }
            } catch (error) {
              if (error instanceof Error && error.name !== "AbortError") {
                setLastResult({
                  runId: "",
                  status: "failed",
                  taskType: "coding",
                  error: error.message,
                });
              }
            } finally {
              try {
                reader.releaseLock();
              } catch {
                /* ignore */
              }
              readerRef.current = null;
              setIsStreaming(false);
              setIsRunning(false);
            }
          };
          void readStream();
        } else {
          // JSON 模式（workflow 类任务）
          const json = await response.json();
          const result = json.data as WorkAgentRunResult;
          setLastResult(result);
          if (result.taskType === "workflow") setRefreshKey((k) => k + 1);
          setIsRunning(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setLastResult({
            runId: "",
            status: "failed",
            taskType: "unknown",
            error: err.message,
          });
        }
        setIsRunning(false);
        setIsStreaming(false);
      }
    },
    [goalInput, isRunning, handleSSEEvent, selectedModel, codingCommand, selectedRouteOverride],
  );

  // ─── HIL 审批 ────────────────────────────────────────────────────────────────

  /** 提交审批决定。scope 决定它走计划层还是动作层。 */
  const submitApproval = useCallback(
    async (
      approval: NonNullable<typeof pendingApproval>,
      decision: "approve" | "reject",
    ) => {
      const res = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: approval.runId,
          scope: approval.scope,
          approvalId: approval.approvalId,
          planVersion: approval.planVersion,
          decision,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        idempotent?: boolean;
        replanned?: boolean;
        execution?: { status?: string; error?: string | null; pendingAction?: unknown };
        run?: { status?: string; error?: string | null } | null;
      };
      if (!res.ok) throw new Error(data.error ?? "审批失败");
      return data;
    },
    [],
  );

  const handleApprove = useCallback(async () => {
    if (!pendingApproval) return;
    const approval = pendingApproval;
    try {
      const data = await submitApproval(approval, "approve");
      setPendingApproval(null);

      // 幂等：重复点击不会重复执行
      if (data.idempotent) {
        setLastResult((prev) => ({
          ...prev!,
          summary: "该审批已处理过，未重复执行",
        }));
        return;
      }

      // 执行可能停在下一个动作审批闸门（写操作需要单独批准）
      const pendingAction = data.execution?.pendingAction as
        | {
            approvalId: string;
            tool: string;
            args: Record<string, unknown>;
            stepId: string;
            planVersion: number;
            reason: string;
          }
        | undefined;
      if (pendingAction) {
        setPendingApproval({
          runId: approval.runId,
          scope: "action",
          approvalId: pendingAction.approvalId,
          planVersion: pendingAction.planVersion,
          tool: pendingAction.tool,
          args: pendingAction.args,
          reason: pendingAction.reason,
        });
        setLastResult((prev) => ({
          ...prev!,
          status: "waiting_approval",
          summary: `计划已批准并开始执行。下一步「${pendingAction.tool}」有副作用，需单独批准，已暂停等你确认。`,
        }));
        setIsStreaming(false);
        setIsRunning(false);
        return;
      }

      // 没有后续动作闸门 → 剩余步骤已跑完（或出错）
      const finished = data.run?.status === "done";
      setLastResult((prev) => ({
        ...prev!,
        status: finished ? "completed" : "failed",
        summary: finished ? "计划已执行完成" : (data.message ?? "执行中"),
        error: data.execution?.error ?? data.run?.error ?? undefined,
      }));
      setIsStreaming(false);
      setIsRunning(false);
      setRefreshKey((k) => k + 1);
    } catch (error) {
      alert(`审批失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [pendingApproval, submitApproval]);

  /**
   * 拒绝是正常控制流，不是错误：
   * 后端会带拒绝理由做有界重规划，返回新计划继续等审批；
   * 重规划预算用尽才落终态。
   */
  const handleDeny = useCallback(async () => {
    if (!pendingApproval) return;
    const approval = pendingApproval;
    try {
      const data = await submitApproval(approval, "reject");
      setPendingApproval(null);
      setIsStreaming(false);
      setIsRunning(false);
      setLastResult((prev) => ({
        ...prev!,
        status: data.replanned ? "waiting_approval" : "cancelled",
        summary:
          data.message ??
          (data.replanned
            ? "已拒绝，正在按你的意见重新规划"
            : "已拒绝"),
      }));
      setRefreshKey((k) => k + 1);
    } catch (error) {
      alert(`拒绝失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [pendingApproval, submitApproval]);

  // ─── Workflow launched 回调 ──────────────────────────────────────────────────

  const handleWorkflowLaunched = useCallback(
    (runId: string, _convId?: string, kind: WorkRoute = "weekly_report") => {
      setRefreshKey((k) => k + 1);
      const isProjectProgress = kind === "project_progress";
      setSelectedItem({
        id: `WorkflowRun-${runId}`,
        kind,
        source: "WorkflowRun",
        sourceId: runId,
        status: isProjectProgress ? "completed" : "running",
        title: isProjectProgress ? "项目进展汇总" : "周报生成",
        updatedAt: new Date().toISOString(),
      });
    },
    [],
  );

  const handleWorkflowDone = useCallback(
    (runId: string, reportId: string) => {
      const set = navigatedRunIdsRef.current;
      if (!set || set.has(runId)) return;
      recordNavigated(runId);
      router.push(`/reports/weekly-reports/${reportId}?from=/ai&mode=work`);
    },
    [router, recordNavigated],
  );

  const handleMeetingCreated = useCallback((mId: string, pId?: string) => {
    setSelectedItem((prev) =>
      prev
        ? {
            ...prev,
            id: `ProjectMeeting-${mId}`,
            sourceId: mId,
            projectId: pId,
            status: "TRANSCRIBING",
          }
        : null,
    );
    setRefreshKey((k) => k + 1);
  }, []);

  // ─── 一键删除任务及其关联产物 ──────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteItem = useCallback(
    async (item: WorkItem, e?: React.MouseEvent) => {
      e?.stopPropagation();
      const isWf = item.source === "WorkflowRun";
      const confirmMsg = isWf
        ? `确定要删除「${item.title}」吗？\n该工作流运行记录及生成的所有产物（如周报报告）都将被一键清理。`
        : `确定要删除「${item.title}」吗？`;

      if (!window.confirm(confirmMsg)) return;

      setDeletingId(item.id);
      try {
        const res = await fetch(
          `/api/ai/work/runs?source=${encodeURIComponent(item.source)}&sourceId=${encodeURIComponent(item.sourceId)}`,
          { method: "DELETE" },
        );

        if (!res.ok) {
          if (item.source === "WorkflowRun") {
            await fetch(`/api/ai/workflows/${item.sourceId}`, {
              method: "DELETE",
            });
          }
        }

        setWorkItems((prev) => prev.filter((i) => i.id !== item.id));
        setWorkflowRuns((prev) => prev.filter((r) => r.id !== item.sourceId));

        if (selectedItem?.id === item.id) {
          setSelectedItem(null);
        }

        setRefreshKey((k) => k + 1);
      } catch (err) {
        alert(`删除失败: ${err instanceof Error ? err.message : "未知错误"}`);
      } finally {
        setDeletingId(null);
      }
    },
    [selectedItem],
  );

  // ─── 清理 SSE 资源 ──────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (readerRef.current) readerRef.current.cancel().catch(() => {});
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // 思考与执行流程实时读秒计时器 (100ms 刷新率，类似 Chat 思考流程)
  useEffect(() => {
    if (!isStreaming || !streamStartTime) return;
    const ticker = setInterval(() => {
      setStreamElapsedMs(Date.now() - streamStartTime);
    }, 100);
    return () => clearInterval(ticker);
  }, [isStreaming, streamStartTime]);

  // ─── 思考与规划流程事件渲染（带每步读秒与规范化展示）─────────────────────────

  const EVENT_CONFIG: Record<
    string,
    { label: string; icon: string; describe?: (payload: Record<string, unknown>) => string }
  > = {
    run_started: {
      label: "初始化任务环境",
      icon: "🚀",
      describe: (p) => (p.runId ? `任务实例: ${String(p.runId).slice(0, 18)}…` : "开始初始化"),
    },
    conversation_linked: {
      label: "关联工作会话",
      icon: "🔗",
      describe: (p) => (p.conversationId ? `会话 ID: ${String(p.conversationId).slice(0, 14)}…` : "已关联会话"),
    },
    decision: {
      label: "服务端策略决策",
      icon: "🧠",
      describe: (p) => {
        const mode = p.mode ? `[${p.mode}] ` : "";
        const intent = p.intent ? `${p.intent} · ` : "";
        return `${mode}${intent}${p.reason || "完成意图分析"}`;
      },
    },
    dispatch_result: {
      label: "流程调度与分派",
      icon: "🔀",
      describe: (p) => (p.summary ? String(p.summary) : `分派为 ${p.taskType || "任务"}`),
    },
    plan_approval_required: {
      label: "多步规划就绪，等待审批",
      icon: "📋",
      describe: (p) => `已生成 ${Array.isArray(p.steps) ? p.steps.length : 0} 步执行路线`,
    },
    workflow_progress: {
      label: "工作流执行推进",
      icon: "📊",
      describe: (p) => String(p.message || p.status || "正在处理"),
    },
    state_update: {
      label: "状态机快照同步",
      icon: "💾",
      describe: (p) => `状态更新为: ${p.status || "running"}`,
    },
    run_completed: {
      label: "流程执行完成",
      icon: "🎉",
      describe: () => "所有规划操作已全部完成",
    },
    pi_run_started: { label: "启动 Pi Coding 引擎", icon: "💻" },
    pi_session_started: { label: "创建代码开发会话", icon: "⚙️", describe: (p) => `会话: ${p.piSessionId || ""}` },
    pi_assistant_message: {
      label: "AI 思考与输出",
      icon: "🤖",
      describe: (p) => {
        const text =
          (p.assistantMessageEvent as { delta?: string; content?: string } | undefined)?.content ||
          (p.content as string) ||
          "";
        return text.slice(0, 80);
      },
    },
    pi_tool_call: {
      label: "调度外部工具",
      icon: "🔧",
      describe: (p) => `调用 ${p.tool || "工具"}`,
    },
    pi_tool_result: { label: "工具执行完毕", icon: "✅" },
    pi_progress: { label: "步骤执行中", icon: "⏳" },
    pi_error: { label: "执行遇到异常", icon: "❌", describe: (p) => String(p.message || "未知错误") },
    error: { label: "服务异常", icon: "❌", describe: (p) => String(p.message || "执行失败") },
  };

  const renderEventCard = (record: SSERecord, idx: number) => {
    const cfg = EVENT_CONFIG[record.type] ?? { label: record.type, icon: "📋" };
    const payload = (record.payload && typeof record.payload === "object" ? record.payload : {}) as Record<
      string,
      unknown
    >;
    const detail = cfg.describe ? cfg.describe(payload) : (payload.message ? String(payload.message) : "");

    // 每步执行耗时读秒计算（相对于前一个事件或起点的时间差）
    const prevTimestamp =
      idx === 0 ? (streamStartTime || record.timestamp) : realtimeEvents[idx - 1].timestamp;
    const stepDiffSec = Math.max(0.1, (record.timestamp - prevTimestamp) / 1000).toFixed(1);

    return (
      <div
        key={record.id}
        className="flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white px-3.5 py-2.5 text-xs shadow-2xs transition hover:border-brand-200 hover:bg-brand-50/20"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] text-brand-700 font-bold border border-brand-100">
            {idx + 1}
          </span>
          <span className="text-sm shrink-0">{cfg.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900 truncate">{cfg.label}</p>
            {detail && <p className="text-[11px] text-ink-500 truncate mt-0.5 font-mono">{detail}</p>}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-ink-600 font-medium border border-ink-200">
          ⏱️ {stepDiffSec}s
        </span>
      </div>
    );
  };

  const allRuns = workItems.slice(0, 15);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const mainPanel = (
    <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden bg-white">
      {/* 执行模型与任务中枢栏 */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-100 bg-ink-50/40 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-2xs">
            <span className="text-sm">⚡</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-ink-900">Work 任务中枢</span>
              <span className="rounded bg-brand-50 px-1.5 py-0.2 text-[10px] font-semibold text-brand-700">
                Agent
              </span>
            </div>
            <p className="text-[11px] text-ink-400">确定性任务调度 · 产物可直接审核</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-500 font-medium hidden sm:inline">模型:</span>
          <div className="w-48 sm:w-56">
            <ModelSelector
              value={selectedModel}
              onChange={(model) => {
                setSelectedModel(model);
                localStorage.setItem("preferredModel", model);
                localStorage.setItem("preferredModel_work", model);
              }}
              category="chat"
              fullWidth
              align="right"
            />
          </div>
        </div>
      </div>

      {/* 可滚动的主内容区域 */}
      <div
        ref={sidebarScrollRef}
        className="flex flex-1 min-h-0 flex-col overflow-y-auto divide-y divide-ink-200"
      >
        {/* Goal 输入 */}
        <div className="space-y-3 px-5 py-4">
          <label
            htmlFor="work-goal"
            className="block text-sm font-medium text-ink-700"
          >
            你希望完成什么？
          </label>
          <textarea
            ref={goalTextareaRef}
            id="work-goal"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
            }}
            onKeyDown={(e) => {
              const isComposing =
                isComposingRef.current ||
                e.nativeEvent.isComposing ||
                e.keyCode === 229 ||
                Date.now() - lastCompositionEndAtRef.current < 100;

              if (e.key === "Enter" && !e.shiftKey) {
                if (isComposing) return;
                e.preventDefault();
                void submitGoal();
              }
            }}
            placeholder="例如：生成本周周报 / 帮我重构 ticket 模块 / 分析会议纪要"
            className="min-h-20 w-full rounded-lg border border-ink-300 bg-white p-3 text-sm outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            disabled={isRunning}
          />
          <div className="space-y-1.5 pt-0.5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-[11px] font-medium text-ink-500">
                目标路由：
                <span className="font-semibold text-brand-600">
                  {route === "auto" ? AUTO_ROUTE_LABEL : routeLabels[route]}
                </span>
              </span>
              {selectedRouteOverride === null && (
                <span className="text-[10px] text-ink-400">已启用自动分诊</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {/* 自动路由按钮 */}
              <button
                type="button"
                onClick={() => setSelectedRouteOverride(null)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  selectedRouteOverride === null
                    ? "bg-brand-600 text-white shadow-2xs"
                    : "border border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50/50"
                }`}
              >
                智能分诊
              </button>
              {/* 5 个具体路由按钮 */}
              {(
                [
                  "weekly_report",
                  "project_progress",
                  "meeting_minutes",
                  "coding",
                  "planning",
                ] as WorkRoute[]
              ).map((r) => {
                const isExplicitActive = selectedRouteOverride === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setSelectedRouteOverride(
                        selectedRouteOverride === r ? null : r,
                      )
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      isExplicitActive
                        ? "bg-brand-600 text-white shadow-2xs"
                        : "border border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:bg-brand-50/50"
                    }`}
                  >
                    {routeLabels[r]}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-ink-400 pt-0.5">
              说明：{route === "auto" ? AUTO_ROUTE_DESC : routeDescriptions[route]}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void submitGoal()}
            disabled={!goalInput.trim() || isRunning}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? "正在执行中…" : "🚀 提交目标并启动任务"}
          </button>
          </div>

          {/* 快捷工作流 */}
          <div className="px-5 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">
              快捷工作流
            </p>
            <WorkflowLauncher
              onWorkflowLaunched={handleWorkflowLaunched}
              onSelectPresetGoal={handleSelectPresetGoal}
              onStartMeetingWorkflow={() => {
                setSelectedItem({
                  id: `new-meeting-${Date.now()}`,
                  kind: "meeting_minutes",
                  source: "ProjectMeeting",
                  sourceId: "",
                  status: "UPLOADING",
                  title: "新建会议纪要",
                  updatedAt: new Date().toISOString(),
                });
              }}
            />
          </div>

          {/* 任务列表 */}
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                任务列表
              </p>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                title="刷新任务列表"
                className="text-xs text-ink-400 hover:text-ink-600"
              >
                刷新
              </button>
            </div>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-lg border border-ink-200 bg-white p-4"
                  >
                    <div className="h-4 w-24 rounded bg-ink-200" />
                    <div className="mt-2 h-3 w-32 rounded bg-ink-100" />
                  </div>
                ))}
              </div>
            ) : allRuns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink-300 p-6 text-center">
                <p className="text-sm text-ink-500">暂无任务记录</p>
                <p className="mt-1 text-xs text-ink-400">
                  输入目标或使用快捷工作流开始
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {allRuns.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  const statusInfo = getStatusBadge(item.status);
                  return (
                    <div
                      key={item.id}
                      className={`group rounded-xl border p-3.5 transition-all ${
                        isSelected
                          ? "border-brand-500 bg-brand-50/50 shadow-sm"
                          : "border-ink-200 bg-white hover:border-ink-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                            {getRouteIcon(item.kind)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink-900">
                              {item.title}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-400">
                              {new Date(item.updatedAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between border-t border-ink-100/60 pt-2">
                        <button
                          type="button"
                          onClick={(e) => void handleDeleteItem(item, e)}
                          disabled={deletingId === item.id}
                          title="一键删除此任务及全部产物"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span>
                            {deletingId === item.id ? "删除中…" : "删除"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItem(item);
                            if (item.conversationId) {
                              onConversationCreated?.(item.conversationId);
                            }
                          }}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                        >
                          查看详情 →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
  );

  const previewPanel = (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white select-none">
      {/* Header with Title and Toggle/Close Button */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-100 px-3.5 bg-white">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-50 text-brand-600 text-xs">
            ⚡
          </span>
          <span className="text-xs font-semibold text-ink-800 tracking-tight">
            {selectedItem
              ? "任务详情与产物"
              : isRunning || isStreaming || lastResult
              ? "工作流执行进度"
              : "工作流预览"}
          </span>
          {selectedItem && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
              {routeLabels[selectedItem.kind] ?? selectedItem.kind}
            </span>
          )}
        </div>
        {onTogglePreviewPanel && (
          <button
            type="button"
            onClick={onTogglePreviewPanel}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition"
            title="收起预览面板"
            aria-label="收起预览面板"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        {selectedItem ? (
          /* 选中了任务 → 展示对应详情 */
          (() => {
            if (selectedItem.kind === "project_progress") {
              return (
                <ProjectProgressDetail
                  runId={selectedItem.sourceId}
                  initialRun={workflowRuns.find(
                    (r) => r.id === selectedItem.sourceId,
                  )}
                  onBack={() => setSelectedItem(null)}
                  onDelete={() => void handleDeleteItem(selectedItem)}
                />
              );
            }

            if (selectedItem.kind === "meeting_minutes") {
              return (
                <MeetingMinutesWorkflow
                  initialMeetingId={selectedItem.sourceId || undefined}
                  initialProjectId={selectedItem.projectId}
                  onBack={() => setSelectedItem(null)}
                  onDelete={() => void handleDeleteItem(selectedItem)}
                  onMeetingCreated={handleMeetingCreated}
                />
              );
            }

            if (selectedItem.kind === "coding") {
              return (
                <CodingTaskDetail
                  item={selectedItem}
                  onBack={() => setSelectedItem(null)}
                  onDelete={() => void handleDeleteItem(selectedItem)}
                />
              );
            }

            if (selectedItem.kind === "planning") {
              return (
                <PlanningTaskDetail
                  runId={selectedItem.sourceId}
                  initialTitle={selectedItem.title}
                  initialStatus={selectedItem.status}
                  conversationId={currentConversationId || undefined}
                  onBack={() => setSelectedItem(null)}
                  onDelete={() => void handleDeleteItem(selectedItem)}
                  onApprove={() => void handleApprove()}
                  onDeny={() => void handleDeny()}
                  onAdvance={(nextPrompt) => void submitGoal(nextPrompt)}
                />
              );
            }

            // weekly_report
            return (
              <div className="flex flex-1 flex-col">
                <div className="mb-4 flex items-center justify-between">
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="flex w-fit items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-800"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    返回列表
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteItem(selectedItem)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>删除此周报及产物</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <WorkflowStatus
                    runId={selectedItem.sourceId}
                    onApproved={(runId, reportId) =>
                      handleWorkflowDone(runId, reportId)
                    }
                    onDone={(runId, snap) => {
                      if (snap?.reportId)
                        handleWorkflowDone(runId, snap.reportId);
                    }}
                  />
                </div>
              </div>
            );
          })()
        ) : !isRunning &&
          !lastResult &&
          goalInput.trim() &&
          route === "coding" ? (
          <CodingCommandPreview
            goal={goalInput}
            model={selectedModel}
            onStartWithPrompt={(cmd, prompt) => void submitGoal(prompt, cmd)}
            onOpenWorkspace={() =>
              window.open("/ai-workspace", "_blank", "noopener,noreferrer")
            }
          />
        ) : lastResult || isStreaming ? (
          /* 正在执行或有结果 → 展示执行面板 */
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-900">执行进度</h2>

            {/* 执行结果 */}
            {lastResult && !isStreaming && (
              <div
                className={`rounded-xl border p-4 text-sm ${
                  lastResult.status === "failed"
                    ? "border-danger-300 bg-danger-50 text-danger-900"
                    : lastResult.status === "completed"
                      ? "border-success-300 bg-success-50 text-success-900"
                      : lastResult.status === "needs_upload"
                        ? "border-warning-300 bg-warning-50 text-warning-900"
                        : "border-brand-300 bg-brand-50 text-brand-900"
                }`}
              >
                {lastResult.error && (
                  <p className="font-medium">❌ {lastResult.error}</p>
                )}
                {lastResult.summary && <p>{lastResult.summary}</p>}
                {lastResult.taskType === "workflow" &&
                  lastResult.workflowName && (
                    <p>✅ 已启动工作流：{lastResult.workflowName}</p>
                  )}
                {lastResult.piOutput && (
                  <div className="mt-2 whitespace-pre-wrap rounded-md border border-ink-200 bg-white p-3 font-mono text-xs text-ink-700">
                    {lastResult.piOutput}
                  </div>
                )}
                {lastResult.status === "needs_upload" && (
                  <div className="mt-3">
                    <Link
                      href="/projects"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                    >
                      <span>前往项目列表</span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  </div>
                )}
                {lastResult.taskType === "planning" && lastResult.steps && lastResult.steps.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-brand-900 flex items-center gap-1.5">
                        <span>📋</span>
                        <span>AI 自主拆解步骤:</span>
                      </p>
                      <span className="rounded bg-brand-100 px-1.5 py-0.2 text-[10px] font-medium text-brand-800">
                        共 {lastResult.steps.length} 步
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {lastResult.steps.map((s, idx) => (
                        <div
                          key={s.id || idx}
                          className="rounded-xl border border-brand-200 bg-white p-3 text-xs text-ink-800 shadow-2xs transition hover:border-brand-300"
                        >
                          <div className="flex items-center justify-between font-semibold text-brand-950">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                                {idx + 1}
                              </span>
                              <span>{s.action}</span>
                            </div>
                            {s.tool && (
                              <span className="rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">
                                {s.tool}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 pl-7 text-xs leading-relaxed text-ink-600">{s.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {lastResult.taskType === "coding" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedItem({
                          id: `PiSession-${lastResult.runId || "active"}`,
                          kind: "coding",
                          source: "PiSessionOwnership",
                          sourceId: lastResult.runId || "active",
                          status: lastResult.status,
                          title: "Coding Task",
                          updatedAt: new Date().toISOString(),
                        });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
                    >
                      <span>💻 在 Work 中查看 Coding 详情</span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <a
                      href={`/ai-workspace${lastResult.runId ? `?session=${encodeURIComponent(lastResult.runId)}` : ""}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3.5 py-2 text-xs font-medium text-ink-700 shadow-2xs transition-colors hover:bg-ink-50"
                    >
                      <span>在独立窗口打开 Workspace</span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* SSE 实时流 */}
            {/* ── 实时思考与规划流程（每一步读秒 + 支持折叠）─────────────── */}
            {(isStreaming || (realtimeEvents.length > 0 && !lastResult?.summary)) && (
              <div className="rounded-xl border border-brand-200 bg-gradient-to-b from-brand-50/40 to-white p-4 shadow-sm transition-all">
                <div className="flex items-center justify-between border-b border-brand-100/80 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-xs text-white shadow-2xs ${
                        isStreaming ? "animate-pulse" : ""
                      }`}
                    >
                      🧠
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-brand-950">
                          {isStreaming ? "AI 正在思考与调度工作流…" : "思考与执行流程完毕"}
                        </span>
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 font-mono text-[10px] font-bold text-brand-700 border border-brand-200">
                          ⏱️ {(streamElapsedMs / 1000).toFixed(1)}s
                        </span>
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
                          {realtimeEvents.length} 步
                        </span>
                      </div>
                      <p className="text-[11px] text-ink-400 mt-0.5">
                        {isStreaming ? "正在实时追踪 Agent 执行轨迹与中间状态" : "所有执行节点已调度完成"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsThinkingCollapsed((c) => !c)}
                      className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 shadow-2xs transition"
                    >
                      {isThinkingCollapsed ? "展开流程 ▼" : "折叠流程 ▲"}
                    </button>
                    {isStreaming && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (readerRef.current) {
                            await readerRef.current.cancel().catch(() => {});
                            readerRef.current = null;
                          }
                          if (abortControllerRef.current) {
                            abortControllerRef.current.abort();
                            abortControllerRef.current = null;
                          }
                          setIsStreaming(false);
                          setIsRunning(false);
                        }}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 shadow-2xs transition"
                      >
                        停止
                      </button>
                    )}
                  </div>
                </div>

                {!isThinkingCollapsed && (
                  <div className="mt-3 space-y-2">
                    {lastResult?.piOutput && (
                      <div className="mb-2.5 whitespace-pre-wrap rounded-xl border border-brand-200 bg-white p-3 font-mono text-xs text-ink-700 shadow-2xs">
                        <p className="mb-1 text-xs font-medium text-brand-700">🤖 Pi 输出:</p>
                        {lastResult.piOutput}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {realtimeEvents.map((r, idx) => renderEventCard(r, idx))}
                    </div>
                    {isStreaming && (
                      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-brand-700 animate-pulse font-mono">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-600 animate-ping" />
                        <span>正在推进当前步骤… ⏱️ {(streamElapsedMs / 1000).toFixed(1)}s</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 决策理由（C2：用户必须能看到"为什么这么走"）────────────── */}
            {lastDecision && (
              <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-primary-900">
                    执行策略：{lastDecision.intent || "未命名"}
                  </p>
                  <span className="rounded bg-primary-100 px-2 py-0.5 text-xs text-primary-700">
                    {lastDecision.mode}
                    {lastDecision.confidence > 0
                      ? ` · 置信度 ${(lastDecision.confidence * 100).toFixed(0)}%`
                      : ""}
                  </span>
                </div>
                <p className="text-sm text-primary-900">{lastDecision.reason}</p>
                {lastDecision.dataScope && (
                  <p className="mt-2 text-xs text-primary-700">
                    数据权限：
                    {lastDecision.dataScope.mode === "all_projects"
                      ? "全部项目（ROOT）"
                      : `成员项目 ${lastDecision.dataScope.projectCount} 个`}
                    {lastDecision.dataScope.truncated ? "（已截断）" : ""}
                  </p>
                )}
                {lastDecision.degraded && (
                  <p className="mt-2 rounded bg-warning-100 p-2 text-xs text-warning-800">
                    ⚠️ 决策服务降级，已退回通用流程：{lastDecision.degraded}
                  </p>
                )}
                {lastDecision.unsupportedConcepts &&
                  lastDecision.unsupportedConcepts.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-warning-800">
                      {lastDecision.unsupportedConcepts.map((concept) => (
                        <li key={concept.concept}>
                          「{concept.concept}」当前无法表达：{concept.why}
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}

            {/* ── 澄清请求：宁可问人，也不编造缺失的条件 ─────────────────── */}
            {clarification && (
              <div className="rounded-xl border-2 border-warning-400 bg-warning-50 p-4">
                <p className="mb-2 text-sm font-semibold text-warning-900">
                  需要你补充信息后才能继续
                </p>
                {clarification.unsupportedConcepts.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {clarification.unsupportedConcepts.map((concept) => (
                      <div key={concept.concept} className="rounded bg-warning-100 p-2">
                        <p className="text-sm font-medium text-warning-900">
                          「{concept.concept}」
                        </p>
                        <p className="text-xs text-warning-800">{concept.why}</p>
                        <p className="mt-1 text-xs italic text-warning-800">
                          {concept.ask}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {clarification.missingInfo.length > 0 && (
                  <ul className="list-inside list-disc text-sm text-warning-900">
                    {clarification.missingInfo.map((info) => (
                      <li key={info}>{info}</li>
                    ))}
                  </ul>
                )}
                {clarification.text && (
                  <p className="mt-2 text-sm text-warning-900">{clarification.text}</p>
                )}
                <button
                  onClick={() => setClarification(null)}
                  className="mt-3 rounded-md bg-warning-600 px-4 py-2 text-sm font-medium text-white hover:bg-warning-700"
                >
                  知道了，我会补充后重新发起
                </button>
              </div>
            )}

            {/* HIL 审批 */}
            {pendingApproval && (
              <div className="rounded-xl border-2 border-warning-400 bg-warning-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <svg
                    className="h-5 w-5 text-warning-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <p className="text-sm font-semibold text-warning-900">
                    {pendingApproval.scope === "plan"
                      ? "请审阅执行计划"
                      : "请批准这个具体操作"}
                  </p>
                </div>
                <div className="mb-3 space-y-1 text-sm text-warning-900">
                  <p>
                    <strong>工具:</strong> {pendingApproval.tool}
                  </p>
                  {pendingApproval.steps && pendingApproval.steps.length > 0 ? (
                    <>
                      <p>
                        <strong>执行计划（{pendingApproval.steps.length} 步）:</strong>
                      </p>
                      <ol className="mt-1 list-inside list-decimal space-y-1">
                        {pendingApproval.steps.map((s) => (
                          <li key={s.id}>
                            <span className="font-medium">{s.action}</span>
                            <span className="text-warning-800">：{s.description}</span>
                            <span className="ml-1 text-xs text-warning-700">
                              [{s.tool}]
                            </span>
                            {s.requiresActionApproval && (
                              <span className="ml-1 rounded bg-warning-200 px-1 text-xs">
                                有副作用 · 执行前需单独批准
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>参数:</strong>
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-warning-100 p-2 text-xs">
                        {JSON.stringify(pendingApproval.args, null, 2)}
                      </pre>
                    </>
                  )}
                  <p className="mt-2 italic">{pendingApproval.reason}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void handleApprove()}
                    className="flex-1 rounded-md bg-success-600 px-4 py-2 text-sm font-medium text-white hover:bg-success-700"
                  >
                    ✓ 批准执行
                  </button>
                  <button
                    onClick={() => void handleDeny()}
                    className="flex-1 rounded-md bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700"
                  >
                    ✗ 拒绝
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* 空状态 → 工作流步骤流程全景预览与导引 */
          <div className="flex h-full w-full flex-1 flex-col justify-start space-y-4 py-2">
            <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/60 via-white to-brand-50/20 p-4 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-sm text-white shadow-2xs">
                  ⚡
                </span>
                <div>
                  <h3 className="text-sm font-bold text-ink-900">
                    Agent 确定性工作流流程预览
                  </h3>
                  <p className="text-xs text-ink-500">
                    标准化分步流水线，涵盖数据采集、智能起草、代码开发与自主规划
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  预置标准化工作流步骤流程预览
                </p>
                <span className="text-[11px] text-ink-400">点击卡片可快速载入目标</span>
              </div>

              {/* 工作流 1: 周报生成 */}
              <div
                onClick={() => handleSelectPresetGoal("生成本周周报", undefined, "weekly_report")}
                className="group cursor-pointer rounded-xl border border-ink-200 bg-white p-4 shadow-2xs transition-all hover:border-brand-300 hover:bg-brand-50/20 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-sm font-bold">
                      📊
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-ink-900 group-hover:text-brand-700 transition">
                        周报自动生成工作流
                      </h4>
                      <p className="text-[11px] text-ink-500">聚合工单、Git 提交与笔记，经草稿审阅后一键落盘</p>
                    </div>
                  </div>
                  <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    3 步流水线
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3">
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">1</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">数据采集</p>
                      <p className="text-[10px] text-ink-400 truncate">工单 & 提交</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">2</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">智能起草</p>
                      <p className="text-[10px] text-ink-400 truncate">提炼重点与风险</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">3</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">审阅落盘</p>
                      <p className="text-[10px] text-ink-400 truncate">人机审批与导出</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 工作流 2: 会议纪要 */}
              <div
                onClick={() => handleSelectPresetGoal("整理本周项目组站会纪要", undefined, "meeting_minutes")}
                className="group cursor-pointer rounded-xl border border-ink-200 bg-white p-4 shadow-2xs transition-all hover:border-brand-300 hover:bg-brand-50/20 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 text-purple-600 text-sm font-bold">
                      🎙️
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-ink-900 group-hover:text-brand-700 transition">
                        会议纪要转写工作流
                      </h4>
                      <p className="text-[11px] text-ink-500">录音拖拽上传，智能转写并按 7 要素抽取决议待办</p>
                    </div>
                  </div>
                  <span className="rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                    3 步流水线
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3">
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white">1</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">音频上传</p>
                      <p className="text-[10px] text-ink-400 truncate">m4a / mp3 预检</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white">2</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">语音转写</p>
                      <p className="text-[10px] text-ink-400 truncate">对齐发言人时间</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white">3</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">纪要沉淀</p>
                      <p className="text-[10px] text-ink-400 truncate">7要素决策与归档</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 工作流 3: Coding 开发任务 */}
              <div
                onClick={() => handleSelectPresetGoal("梳理工单流转逻辑并修复评论异常", "plan", "coding")}
                className="group cursor-pointer rounded-xl border border-ink-200 bg-white p-4 shadow-2xs transition-all hover:border-brand-300 hover:bg-brand-50/20 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 text-sm font-bold">
                      💻
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-ink-900 group-hover:text-brand-700 transition">
                        Pi Coding 开发与审查工作流
                      </h4>
                      <p className="text-[11px] text-ink-500">影响范围梳理、多步方案实施与代码合规质量审查</p>
                    </div>
                  </div>
                  <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    3 步流水线
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3">
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">1</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">影响梳理</p>
                      <p className="text-[10px] text-ink-400 truncate">/reach 依赖分析</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">2</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">方案计划</p>
                      <p className="text-[10px] text-ink-400 truncate">/plan 拆解步骤</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-ink-50/80 p-2 text-[11px]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">3</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-800 truncate">受控执行</p>
                      <p className="text-[10px] text-ink-400 truncate">/goal 实施交付</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-3 text-xs text-amber-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  <span>🛡️</span>
                  <span>人机协同与安全保证</span>
                </div>
                {onSwitchToConversation && (
                  <button
                    type="button"
                    onClick={onSwitchToConversation}
                    className="text-[11px] font-medium text-brand-600 hover:text-brand-800 transition"
                  >
                    切换至 Chat 模式 →
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                涉及持久化写入与高风险操作时，系统会生成审批卡片等待人工核验，批准后方可执行。
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );

  if (typeof children === "function") {
    return children({ mainPanel, previewPanel });
  }

  return (
    <div className="flex h-full w-full min-h-0 overflow-hidden">
      {mainPanel}
      <div
        className={`ai-right-panel-container ${
          previewPanelOpen ? "ai-right-panel-open" : "ai-right-panel-closed"
        }`}
        style={{
          "--right-panel-width": "clamp(380px, 48vw, 760px)",
        } as React.CSSProperties}
      >
        {previewPanel}
      </div>
    </div>
  );
}

// ─── Route Detail Sub-Components ───────────────────────────────────────────────

function CodingCommandPreview({
  goal,
  model,
  onStartWithPrompt,
  onOpenWorkspace,
}: {
  goal: string;
  model: string;
  onStartWithPrompt: (command: string, prompt: string) => void;
  onOpenWorkspace: () => void;
}) {
  const [isRouting, setIsRouting] = useState(false);
  const [routeData, setRouteData] = useState<RoutePreflightResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<PiCommandKey[]>([
    "plan",
    "goal",
    "review",
  ]);
  const [editedSteps, setEditedSteps] = useState<Record<number, string>>({});
  const [viewMode, setViewMode] = useState<"interactive" | "raw">("interactive");
  const [copied, setCopied] = useState(false);

  // 显式触发 /route 方案规划生成（避免输入检测死循环）
  const fetchRoutePlan = useCallback(
    async (overrideKeys?: PiCommandKey[]) => {
      const keysToUse = overrideKeys || selectedKeys;
      if (!goal.trim()) {
        setRouteData(null);
        return;
      }
      setIsRouting(true);
      try {
        const res = await fetch("/api/ai/work/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: goal, selectedCommands: keysToUse }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            setRouteData(json.data);
            if (Array.isArray(json.data.selectedCommandKeys)) {
              setSelectedKeys(json.data.selectedCommandKeys);
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        setIsRouting(false);
      }
    },
    [goal, selectedKeys],
  );

  // 初次加载或目标初次变化时触发一次（无死循环）
  const lastGoalRef = useRef<string>("");
  useEffect(() => {
    if (goal.trim() && lastGoalRef.current !== goal.trim()) {
      lastGoalRef.current = goal.trim();
      void fetchRoutePlan();
    }
  }, [goal, fetchRoutePlan]);

  const toggleCommandKey = useCallback(
    (key: PiCommandKey) => {
      const nextKeys = selectedKeys.includes(key)
        ? selectedKeys.filter((k) => k !== key)
        : [...selectedKeys, key];
      const validNextKeys = nextKeys.length > 0 ? nextKeys : [key];
      setSelectedKeys(validNextKeys);
      // 多选状态发生变动时，即时以最新命令集调用 /route 重构规划
      void fetchRoutePlan(validNextKeys);
    },
    [selectedKeys, fetchRoutePlan],
  );

  const handleStepPromptChange = useCallback(
    (index: number, newPrompt: string) => {
      setEditedSteps((prev) => ({ ...prev, [index]: newPrompt }));
    },
    [],
  );

  const handleCopyRaw = useCallback(async () => {
    if (!routeData?.rawText) return;
    try {
      await navigator.clipboard.writeText(routeData.rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [routeData]);

  const activeSteps = routeData?.steps ?? [];
  const firstStep = activeSteps[0];
  const firstCommand = firstStep?.command ?? "/goal";
  const firstPrompt =
    (firstStep ? editedSteps[firstStep.index] : undefined) ??
    firstStep?.prompt ??
    goal;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center space-y-5 py-6">
      <div className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm">
        {/* 顶部标题区 */}
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                <span>🎯</span>
                <span>Pi Route 推荐工作流方案与指令规划</span>
              </span>
              {isRouting ? (
                <span className="flex items-center gap-1.5 text-[11px] text-brand-600">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-brand-500" />
                  <span>/route 动态规划中…</span>
                </span>
              ) : (
                <span className="text-[11px] font-medium text-emerald-600">
                  ✓ 规划已完成
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-xl font-bold text-ink-900">
              工作流方案与分步指令规划
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              已依据输入目标生成最佳路线。支持在下方多选切换命令（规划将自动重构），并在最下方二次确认与微调提示词。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchRoutePlan()}
              disabled={isRouting || !goal.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 shadow-2xs transition hover:bg-ink-50 disabled:opacity-50"
            >
              <span>{isRouting ? "规划中…" : "🔄 重新规划"}</span>
            </button>
            <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-ink-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("interactive")}
              className={`rounded-md px-2 py-1 font-medium transition ${
                viewMode === "interactive"
                  ? "bg-white text-ink-900 shadow-xs"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              交互视图
            </button>
            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={`rounded-md px-2 py-1 font-medium transition ${
                viewMode === "raw"
                  ? "bg-white text-ink-900 shadow-xs"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              纯文本输出
            </button>
          </div>
        </div>
        </div>

        {viewMode === "raw" ? (
          /* 纯文本控制台呈现 */
          <div className="mt-4 space-y-3">
            <div className="relative">
              <pre className="max-h-[480px] overflow-auto rounded-xl border border-ink-800 bg-ink-950 p-4 font-mono text-xs leading-relaxed text-emerald-400 shadow-inner">
                {routeData?.rawText || "正在生成 Pi Route 规划文本…"}
              </pre>
              <button
                type="button"
                onClick={() => void handleCopyRaw()}
                className="absolute right-3 top-3 rounded-lg bg-ink-800/80 px-2.5 py-1 text-xs font-medium text-ink-200 backdrop-blur transition hover:bg-ink-700"
              >
                {copied ? "✓ 已复制" : "复制全部"}
              </button>
            </div>
          </div>
        ) : (
          /* 交互式可视化呈现 */
          <div className="mt-4 space-y-5">
            {/* 1. 最佳方案路线 */}
            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-950">
                  <span>🚀</span>
                  <span>推荐执行路线:</span>
                </span>
                <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-800 border border-brand-200">
                  推荐置信度: {routeData?.confidence || "60%"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {routeData?.bestRouteSteps &&
                routeData.bestRouteSteps.length > 0 ? (
                  routeData.bestRouteSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-white px-3.5 py-1.5 text-xs font-medium text-ink-900 shadow-2xs hover:border-brand-300 transition">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white shadow-2xs">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-brand-950">{step}</span>
                      </div>
                      {idx < routeData.bestRouteSteps.length - 1 && (
                        <span className="text-sm font-bold text-brand-400">
                          →
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="font-mono text-xs text-ink-600">
                    {routeData?.bestRouteText ||
                      "方案规划  →  目标交付  →  合规与质量审计"}
                  </p>
                )}
              </div>
            </div>

            {/* 2. 当前可用能力 & 交互式多选切换 */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="flex items-center gap-1 text-xs font-semibold text-ink-800">
                  <span>⚙️</span>
                  <span>
                    当前可用能力 (点击可多选/取消勾选，规划将即时重构):
                  </span>
                </p>
                <span className="text-[11px] text-ink-400">
                  支持自由组合工作流能力
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ALL_PI_CAPABILITIES.map((cap) => {
                  const isChecked = selectedKeys.includes(cap.key);
                  return (
                    <button
                      key={cap.key}
                      type="button"
                      onClick={() => toggleCommandKey(cap.key)}
                      className={`relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                        isChecked
                          ? "border-brand-500 bg-brand-50/70 shadow-xs ring-1 ring-brand-500/40"
                          : "border-ink-200 bg-white opacity-75 hover:border-ink-300 hover:opacity-100"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[11px] font-bold transition ${
                          isChecked
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-ink-300 bg-white text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-ink-900">
                            {cap.name}
                          </span>
                          <span className="rounded bg-brand-50 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-brand-700 border border-brand-100">
                            {cap.command}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                          {cap.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. 分步执行指令与优化提示词规划 (二次确认与直接编辑) */}
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="flex items-center gap-1 text-xs font-semibold text-ink-800">
                  <span>📝</span>
                  <span>
                    分步执行指令与优化提示词规划 (支持直接编辑微调):
                  </span>
                </p>
                <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-medium text-brand-700">
                  共 {activeSteps.length} 个步骤
                </span>
              </div>

              {isRouting ? (
                <div className="space-y-3 py-2 animate-pulse">
                  <div className="h-16 w-full rounded-xl bg-ink-100" />
                  <div className="h-16 w-full rounded-xl bg-ink-100" />
                </div>
              ) : (
                <div className="space-y-3">
                  {activeSteps.map((step) => {
                    const currentPrompt =
                      editedSteps[step.index] ?? step.prompt;
                    return (
                      <div
                        key={step.index}
                        className="rounded-xl border border-ink-200 bg-white p-3.5 text-xs shadow-2xs transition hover:border-brand-300"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white shadow-2xs">
                              {step.index}
                            </span>
                            <span className="font-bold text-ink-900">
                              [{step.title}]
                            </span>
                          </div>
                          <span className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-700">
                            指令: {step.command}
                          </span>
                        </div>
                        <div className="mt-2.5">
                          <label className="block">
                            <span className="text-[11px] font-medium text-ink-500">
                              提示词 (可在此二次编辑):
                            </span>
                            <textarea
                              value={currentPrompt}
                              onChange={(e) =>
                                handleStepPromptChange(
                                  step.index,
                                  e.target.value,
                                )
                              }
                              className="mt-1 min-h-16 w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs leading-relaxed text-ink-800 outline-none transition-all focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="text-[11px] text-ink-400">执行模型：{model}</p>
          </div>
        )}

        {/* 4. 底部操作栏 */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!goal.trim()}
              onClick={() => onStartWithPrompt(firstCommand, firstPrompt)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-5 py-2.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>🚀 确认并启动 Pi 会话</span>
            </button>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-xs font-medium text-ink-700 shadow-2xs transition hover:bg-ink-50"
            >
              新窗口打开 Workspace ↗
            </button>
          </div>
          <span className="text-[11px] text-ink-400">
            启动后右侧将直接嵌入展示 Pi Web 实时会话工作区
          </span>
        </div>
      </div>
    </div>
  );
}

function getRouteIcon(kind: WorkRoute) {
  switch (kind) {
    case "weekly_report":
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "meeting_minutes":
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      );
    case "coding":
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "planning":
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "project_progress":
    default:
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
  }
}

function getStatusBadge(status: string) {
  const isDone =
    status === "completed" ||
    status === "done" ||
    status === "PUBLISHED" ||
    status === "ready";
  const isFailed = status === "failed" || status === "cancelled";
  const isReview = status === "waiting_review" || status === "PENDING_REVIEW";

  if (isDone) {
    return {
      label: status === "PUBLISHED" ? "已发布" : "已完成",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (isFailed) {
    return {
      label: status === "cancelled" ? "已取消" : "失败",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }
  if (isReview) {
    return {
      label: "待审阅",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label:
      status === "running"
        ? "运行中"
        : status === "collecting"
          ? "采集中"
          : status === "drafting"
            ? "生成中"
            : status,
    className: "border-brand-100 bg-brand-50 text-brand-800",
  };
}
function getTicketStatusBadge(status: string) {
  switch (status) {
    case "DEVELOPING":
      return {
        label: "开发中",
        className: "bg-blue-50 text-blue-700 border-blue-200",
      };
    case "READY_FOR_TEST":
      return {
        label: "待测试",
        className: "bg-purple-50 text-purple-700 border-purple-200",
      };
    case "DONE":
      return {
        label: "已完成",
        className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    case "DELIVERED":
      return {
        label: "已交付",
        className: "bg-teal-50 text-teal-700 border-teal-200",
      };
    case "CLOSED":
      return {
        label: "已关闭",
        className: "bg-gray-100 text-gray-600 border-gray-200",
      };
    case "OVERDUE":
      return {
        label: "逾期",
        className: "bg-red-50 text-red-700 border-red-200",
      };
    default:
      return {
        label: status,
        className: "bg-ink-50 text-ink-700 border-ink-200",
      };
  }
}

function ProjectProgressDetail({
  runId,
  initialRun,
  onBack,
  onDelete,
}: {
  runId: string;
  initialRun?: WorkflowRun;
  onBack: () => void;
  onDelete?: () => void;
}) {
  const [fetchedRun, setFetchedRun] = useState<WorkflowRun | null>(null);
  const [isLoading, setIsLoading] = useState(!initialRun);

  useEffect(() => {
    if (initialRun) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/ai/workflows/${runId}`);
        if (res.ok && !cancelled) {
          const json = await res.json();
          if (json.data?.workflowRun) {
            setFetchedRun(json.data.workflowRun);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId, initialRun]);

  const run = initialRun ?? fetchedRun;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const meta =
    run?.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : {};
  const summary = (meta.summary as string) || "暂无进展汇总内容";
  const ticketCount =
    typeof meta.ticketCount === "number" ? meta.ticketCount : 0;
  const inProgressCount =
    typeof meta.inProgressCount === "number" ? meta.inProgressCount : 0;
  const resolvedCount =
    typeof meta.resolvedCount === "number" ? meta.resolvedCount : 0;
  const commitCount =
    typeof meta.commitCount === "number" ? meta.commitCount : 0;

  const tickets = Array.isArray(meta.tickets)
    ? (meta.tickets as Array<{
        id: string;
        ticketNo: number;
        title: string;
        status: string;
        priority: number;
        projectName: string;
        moduleName: string;
        assignees: string[];
        updatedAt: string;
      }>)
    : [];

  const commits = Array.isArray(meta.commits)
    ? (meta.commits as Array<{
        id: string;
        commitSha: string;
        shortSha: string;
        author: string;
        subject: string;
        committedAt: string;
        ticketNo: number;
        ticketId?: string;
        ticketTitle?: string;
      }>)
    : [];

  const history = Array.isArray(run?.history)
    ? (run.history as Array<{
        timestamp: string;
        action?: string;
        note?: string;
      }>)
    : [];

  return (
    <div className="flex flex-1 flex-col space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-800"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回列表
        </button>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>删除此进展记录</span>
            </button>
          )}
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              run?.status === "completed" || run?.status === "done"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : run?.status === "failed"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-brand-100 bg-brand-50 text-brand-800"
            }`}
          >
            {run?.status === "completed" || run?.status === "done"
              ? "已完成"
              : run?.status || "进行中"}
          </span>
        </div>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-ink-900">项目进展汇总</h1>
        <p className="mt-1 text-xs text-ink-500">
          更新时间：
          {run?.updatedAt ? new Date(run.updatedAt).toLocaleString() : "-"}
        </p>
      </header>

      {/* 4 项核心数据指标 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-xs font-medium text-ink-500">活跃工单总数</p>
          <p className="mt-1 text-2xl font-bold text-ink-900">{ticketCount}</p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-xs font-medium text-blue-600">正在推进任务</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">
            {inProgressCount || "-"}
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-xs font-medium text-emerald-600">已完成/交付</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {resolvedCount || "-"}
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <p className="text-xs font-medium text-purple-600">最近代码提交</p>
          <p className="mt-1 text-2xl font-bold text-purple-600">
            {commitCount}
          </p>
        </div>
      </div>

      {/* AI 智能综述与进展分析 */}
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 border-b border-ink-100 pb-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </span>
          <h2 className="text-sm font-semibold text-ink-900">
            智能综述与进展分析
          </h2>
        </div>
        <div className="prose prose-sm max-w-none text-ink-800">
          <MarkdownContent content={summary} />
        </div>
      </div>

      {/* 重点工单列表 */}
      {tickets.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-ink-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <h2 className="text-sm font-semibold text-ink-900">
                重点追踪工单 ({tickets.length})
              </h2>
            </div>
            <span className="text-xs text-ink-400">点击工单号可直达详情</span>
          </div>
          <div className="divide-y divide-ink-100">
            {tickets.map((t) => {
              const statusBadge = getTicketStatusBadge(t.status);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/tickets/${t.id}`}
                        target="_blank"
                        className="font-mono font-semibold text-brand-600 hover:underline"
                      >
                        #{t.ticketNo}
                      </Link>
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                        P{t.priority}
                      </span>
                      <span className="truncate font-medium text-ink-900">
                        {t.title}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-400">
                      <span>项目：{t.projectName}</span>
                      <span>·</span>
                      <span>模块：{t.moduleName}</span>
                      {t.assignees.length > 0 && (
                        <>
                          <span>·</span>
                          <span>负责人：{t.assignees.join("、")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/tickets/${t.id}`}
                    target="_blank"
                    className="flex-shrink-0 font-medium text-brand-600 hover:text-brand-700"
                  >
                    查看 ↗
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近代码提交 */}
      {commits.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-ink-100 pb-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-50 text-purple-600">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </span>
            <h2 className="text-sm font-semibold text-ink-900">
              最近代码提交记录 ({commits.length})
            </h2>
          </div>
          <div className="divide-y divide-ink-100 font-mono text-xs">
            {commits.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1 font-sans">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-brand-600">
                      {c.shortSha}
                    </span>
                    <span className="truncate text-xs font-medium text-ink-800">
                      {c.subject}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 font-sans text-[11px] text-ink-400">
                    <span>作者：{c.author}</span>
                    <span>·</span>
                    <span>
                      时间：{new Date(c.committedAt).toLocaleString()}
                    </span>
                    {c.ticketNo && (
                      <>
                        <span>·</span>
                        <span>关联工单：#{c.ticketNo}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 执行历史 */}
      {history.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-800">执行历史</h2>
          <ol className="mt-3 space-y-2 text-xs text-ink-600">
            {history.map((h, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-ink-400">
                  {new Date(h.timestamp).toLocaleTimeString()}
                </span>
                <span>{h.note || h.action || "状态更新"}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function CodingTaskDetail({
  item,
  onBack,
  onDelete,
}: {
  item: WorkItem;
  onBack: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex items-center justify-between border-b border-ink-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-800"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回列表
          </button>
          <span className="text-ink-300">|</span>
          <span className="font-semibold text-ink-900">{item.title}</span>
          <span className="font-mono text-xs text-ink-400">
            ({item.sourceId})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>删除此任务</span>
            </button>
          )}
          <a
            href={`/ai-workspace${item.sourceId ? `?session=${item.sourceId}` : ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
          >
            <span>在新窗口打开 Workspace</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
        {item.sourceId ? (
          <iframe
            key={item.sourceId}
            title={`Pi Workspace · ${item.title}`}
            src={`/ai-workspace?fullscreen=1&session=${encodeURIComponent(item.sourceId)}`}
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-500">
            正在创建 Pi 会话，创建完成后将在这里实时预览具体进展。
          </div>
        )}
      </div>
    </div>
  );
}

function PlanningTaskDetail({
  runId,
  initialTitle,
  initialStatus,
  conversationId,
  onBack,
  onDelete,
  onAdvance,
}: {
  runId: string;
  initialTitle?: string;
  initialStatus?: string;
  conversationId?: string;
  onBack: () => void;
  onDelete?: () => void;
  onApprove?: () => void;
  onDeny?: () => void;
  onAdvance?: (prompt: string) => void;
}) {
  const [fetchedRun, setFetchedRun] = useState<WorkflowRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [followUpInput, setFollowUpInput] = useState("");
  const [isFollowUpSending, setIsFollowUpSending] = useState(false);
  // 步骤折叠状态与高精度读秒
  const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({});
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());

  const handleSendFollowUp = async () => {
    const text = followUpInput.trim();
    if (!text || isFollowUpSending) return;
    setIsFollowUpSending(true);
    setFollowUpInput("");
    try {
      if (isWaitingApproval) {
        // 在待审批阶段输入修改意见，触发自适应重规划
        const res = await fetch("/api/ai/work/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId,
            scope: "plan",
            approvalId: `plan_${runId}_v${planVersion}`,
            planVersion,
            decision: "reject",
            feedback: text,
          }),
        });
        const data = await res.json();
        if (!res.ok) alert(`重规划失败: ${data.error ?? "未知错误"}`);
        await reload();
      } else {
        // 在完成或后续阶段，通过 onAdvance 推进工作流
        if (onAdvance) {
          onAdvance(text);
        } else {
          const res = await fetch("/api/ai/work/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: text,
              conversationId: fetchedRun?.conversationId ?? conversationId ?? undefined,
            }),
          });
          if (!res.ok) {
            const data = await res.json();
            alert(`推进失败: ${data.error ?? "未知错误"}`);
          }
          await reload();
        }
      }
    } catch (e) {
      alert(`指令发送异常: ${e instanceof Error ? e.message : "网络错误"}`);
    } finally {
      setIsFollowUpSending(false);
    }
  };

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/workflows/${runId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data?.run) {
          setFetchedRun(json.data.run);
        }
      }
    } catch {}
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/ai/workflows/${runId}`);
        if (res.ok && !cancelled) {
          const json = await res.json();
          if (json.data?.run) {
            setFetchedRun(json.data.run);
          }
        }
      } catch {
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // 运行期自轮询：当处于 running 或 planning 时每 2 秒拉一次最新状态
  const status = fetchedRun?.status || initialStatus || "waiting_review";
  useEffect(() => {
    if (status !== "running" && status !== "planning") return;
    const timer = setInterval(() => {
      void reload();
    }, 2000);
    return () => clearInterval(timer);
  }, [status, reload]);

  // 步骤级高频读秒定时器 (100ms)
  useEffect(() => {
    if (status !== "running" && status !== "planning") return;
    const ticker = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(ticker);
  }, [status]);

  const toggleStep = (stepId: string) => {
    setCollapsedSteps((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  const toggleAllSteps = () => {
    const nextState = !allCollapsed;
    setAllCollapsed(nextState);
    const updated: Record<string, boolean> = {};
    for (const s of steps) {
      updated[s.id] = nextState;
    }
    setCollapsedSteps(updated);
  };

  const meta =
    fetchedRun?.metadata && typeof fetchedRun.metadata === "object"
      ? (fetchedRun.metadata as Record<string, unknown>)
      : {};

  const planVersion =
    typeof meta.activePlanVersion === "number"
      ? meta.activePlanVersion
      : typeof meta.planVersion === "number"
        ? meta.planVersion
        : 1;

  const plans = (meta.plans && typeof meta.plans === "object" ? meta.plans : {}) as Record<
    string,
    {
      goal?: string;
      title?: string;
      steps?: Array<{
        id: string;
        action: string;
        description: string;
        tool?: string;
        args?: Record<string, unknown>;
        dependsOn?: string[];
        requiresActionApproval?: boolean;
        riskNote?: string;
      }>;
    }
  >;
  const currentPlan = plans[String(planVersion)] || plans["1"];

  const title =
    (meta.title as string) || currentPlan?.title || initialTitle || "自主规划任务";
  const userInput = (meta.userInput as string) || currentPlan?.goal || "";

  const steps = Array.isArray(currentPlan?.steps)
    ? currentPlan.steps
    : Array.isArray(meta.steps)
      ? (meta.steps as Array<{
          id: string;
          action: string;
          description: string;
          tool?: string;
          args?: Record<string, unknown>;
          dependsOn?: string[];
          requiresActionApproval?: boolean;
        }>)
      : [];

  const stepResults = (meta.stepResults && typeof meta.stepResults === "object"
    ? meta.stepResults
    : {}) as Record<
    string,
    {
      status?: "pending" | "running" | "done" | "failed" | "waiting_action_approval";
      startedAt?: number;
      finishedAt?: number;
      error?: string;
      result?: { content?: string; details?: unknown };
    }
  >;

  const isWaitingApproval =
    status === "waiting_review" ||
    status === "waiting_approval" ||
    status === "waiting_plan_approval";

  // 提取已生成的报告/回答 Markdown
  const generatedReport = (() => {
    // 1. 优先提取带有 Markdown 标题的正式报告
    for (const res of Object.values(stepResults)) {
      if (
        res?.result?.content &&
        (res.result.content.startsWith("# ") || res.result.content.includes("## "))
      ) {
        return res.result.content;
      }
    }
    // 2. 提取任意已完成步骤的文本产出
    for (const res of Object.values(stepResults)) {
      if (res?.result?.content && res.status === "done") {
        return res.result.content;
      }
    }
    // 3. 提取任务 summary（如直接回复）
    if (meta.summary && typeof meta.summary === "string" && meta.summary !== title) {
      return meta.summary;
    }
    return null;
  })();

  const handleDetailApprove = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          scope: "plan",
          approvalId: `plan_${runId}_v${planVersion}`,
          planVersion,
          decision: "approve",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`审批失败: ${data.error ?? "未知错误"}`);
      }
      await reload();
    } catch (e) {
      alert(`审批异常: ${e instanceof Error ? e.message : "网络错误"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDetailDeny = async () => {
    const reason = prompt(
      "请输入拒绝原因或调整意见（系统将依据你的反馈重新规划）：",
      "计划步骤不符合要求，请优化",
    );
    if (reason === null) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          scope: "plan",
          approvalId: `plan_${runId}_v${planVersion}`,
          planVersion,
          decision: "reject",
          feedback: reason || "用户拒绝了该计划",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`拒绝失败: ${data.error ?? "未知错误"}`);
      }
      await reload();
    } catch (e) {
      alert(`拒绝异常: ${e instanceof Error ? e.message : "网络错误"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col space-y-6">
      <div className="flex items-center justify-between border-b border-ink-200 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-800"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回列表
          </button>
          <span className="text-ink-300">|</span>
          <span className="font-semibold text-ink-900">{title}</span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 border border-brand-200">
            {isWaitingApproval ? "待人工审批" : status === "done" ? "已完成" : status === "running" ? "执行中" : status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>删除此任务</span>
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        </div>
      ) : (
        <div className="space-y-6">
          {userInput && (
            <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                🎯 目标需求
              </p>
              <p className="mt-2 text-sm text-ink-800 leading-relaxed font-medium">
                {userInput}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center justify-between border-b border-ink-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </span>
                <h2 className="text-sm font-semibold text-ink-900">
                  AI 自主拆解步骤清单 (共 {steps.length} 步 · 计划 v{planVersion})
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-400">
                  状态：{isWaitingApproval ? "待确认" : status === "done" ? "已完成" : status}
                </span>
                {steps.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllSteps}
                    className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 transition"
                  >
                    {allCollapsed ? "全部展开 ▼" : "全部折叠 ▲"}
                  </button>
                )}
              </div>
            </div>

            {steps.length > 0 ? (
              <div className="space-y-3">
                {steps.map((step, idx) => {
                  const resultRecord = stepResults[step.id];
                  const stepStatus = resultRecord?.status ?? "pending";
                  const isCollapsed = Boolean(collapsedSteps[step.id]);

                  // 读秒与耗时计算
                  let timingBadge: ReactNode = null;
                  if (stepStatus === "done") {
                    if (
                      typeof resultRecord?.finishedAt === "number" &&
                      typeof resultRecord?.startedAt === "number"
                    ) {
                      const durSec = Math.max(
                        0.1,
                        (resultRecord.finishedAt - resultRecord.startedAt) / 1000,
                      ).toFixed(1);
                      timingBadge = (
                        <span className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-700">
                          ⏱️ 耗时 {durSec}s
                        </span>
                      );
                    }
                  } else if (stepStatus === "running") {
                    const start = resultRecord?.startedAt || now;
                    const elapsedSec = Math.max(0.1, (now - start) / 1000).toFixed(1);
                    timingBadge = (
                      <span className="rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 font-mono text-[10px] font-medium text-blue-700 animate-pulse">
                        ⏳ 执行中 {elapsedSec}s
                      </span>
                    );
                  }

                  return (
                    <div
                      key={step.id || idx}
                      className="flex flex-col gap-2 rounded-lg border border-brand-100 bg-brand-50/40 p-3.5 transition hover:border-brand-300"
                    >
                      {/* 卡片头部（支持点击快速折叠/展开） */}
                      <div
                        onClick={() => toggleStep(step.id)}
                        className="flex items-start gap-3 cursor-pointer select-none group"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 font-mono text-xs font-bold text-white shadow-2xs">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-brand-950 group-hover:text-brand-700 transition-colors">
                              {step.action}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {stepStatus === "done" && (
                                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                  ✓ 已完成
                                </span>
                              )}
                              {stepStatus === "running" && (
                                <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 animate-pulse">
                                  ⏳ 执行中
                                </span>
                              )}
                              {stepStatus === "failed" && (
                                <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                                  ✗ 失败
                                </span>
                              )}
                              {stepStatus === "waiting_action_approval" && (
                                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                  ⚠️ 待动作审批
                                </span>
                              )}
                              {timingBadge}
                              {step.tool && (
                                <span className="rounded bg-brand-100 px-2 py-0.5 font-mono text-[11px] text-brand-700">
                                  工具: {step.tool}
                                </span>
                              )}
                              {step.requiresActionApproval && (
                                <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] text-amber-900">
                                  有副作用
                                </span>
                              )}
                              {step.dependsOn && step.dependsOn.length > 0 && (
                                <span className="rounded bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">
                                  依赖: {step.dependsOn.join(", ")}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleStep(step.id);
                                }}
                                className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-500 hover:bg-ink-200 hover:text-ink-700 transition"
                              >
                                {isCollapsed ? "展开明细 ▼" : "折叠 ▲"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 卡片详情区（折叠时不显示，避免长文本霸屏） */}
                      {!isCollapsed && (
                        <div className="pl-9 pt-1">
                          <p className="text-xs text-ink-600 leading-relaxed">
                            {step.description}
                          </p>
                          {resultRecord?.result?.content && (
                            <div className="mt-2.5 rounded-md bg-white border border-ink-100 p-3 text-xs text-ink-800 shadow-2xs">
                              <p className="font-semibold text-ink-500 mb-1">执行产出：</p>
                              <div className="prose prose-xs max-w-none text-ink-900 leading-relaxed">
                                <MarkdownContent content={resultRecord.result.content} />
                              </div>
                            </div>
                          )}
                          {resultRecord?.error && (
                            <p className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                              错误: {resultRecord.error}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-400">暂无步骤记录</p>
            )}
          </div>

          {/* 生成的报告/回复展示 */}
          {generatedReport && (
            <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-xs">
              <div className="mb-3 flex items-center gap-2 border-b border-ink-100 pb-3">
                <span className="text-base">{generatedReport.startsWith("# ") ? "📊" : "💬"}</span>
                <h3 className="text-sm font-semibold text-ink-900">
                  {generatedReport.startsWith("# ") ? "执行产出复盘报告" : "AI 回复与产出内容"}
                </h3>
              </div>
              <div className="prose prose-sm max-w-none text-ink-800">
                <MarkdownContent content={generatedReport} />
              </div>
            </div>
          )}

          {isWaitingApproval && (
            <div className="rounded-xl border-2 border-warning-400 bg-warning-50 p-5 shadow-xs">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-warning-900">
                    人机协同审批确认 (HIL Gate · 计划 v{planVersion})
                  </h3>
                  <p className="mt-1 text-xs text-warning-800 leading-relaxed">
                    以上多步计划由 LLM 自主生成，请核验动作边界与工具权限。批准后系统将启动持久化幂等执行。
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleDetailApprove()}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isSubmitting ? "处理中…" : "✓ 批准执行"}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleDetailDeny()}
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-medium text-red-600 shadow-xs transition hover:bg-red-50 disabled:opacity-50"
                  >
                    ✗ 拒绝并重规划
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── 底部交互推进对话框 ──────────────────────────── */}
          <div className="sticky bottom-0 rounded-xl border border-ink-200 bg-white/95 p-3.5 shadow-sm backdrop-blur-xs">
            <div className="flex items-end gap-2">
              <textarea
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendFollowUp();
                  }
                }}
                placeholder={
                  isWaitingApproval
                    ? "提出调整意见（如“请精简为两步”、“换个分析维度”）以触发重规划，按 Enter 发送…"
                    : "输入后续指令推进此工作流进程（如“帮我把这些延期工单导出整改单”），按 Enter 发送…"
                }
                rows={2}
                className="flex-1 resize-none bg-transparent px-2.5 py-1.5 text-xs text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={isFollowUpSending || !followUpInput.trim()}
                onClick={() => void handleSendFollowUp()}
                className="rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-brand-700 disabled:opacity-40"
              >
                {isFollowUpSending ? "处理中…" : "发送推进 →"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">
              {isWaitingApproval
                ? "💡 提示：在此输入修改意见将自动触发带反馈的自适应重规划；确认无误可点击上方「✓ 批准执行」"
                : "💡 提示：输入后续指令将无缝继承当前工作流上下文，并在左侧「工作」对话记录中保持实时双向同步"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
