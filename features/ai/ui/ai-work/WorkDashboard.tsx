"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  routeWorkGoal,
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
  metadata?: unknown;
}

interface WorkAgentRunResult {
  runId: string;
  status: string;
  taskType: "workflow" | "coding" | "unknown";
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

const routeLabels: Record<WorkRoute, string> = {
  project_progress: "项目进展汇总",
  weekly_report: "周报生成",
  meeting_minutes: "会议纪要",
  coding: "Coding Task",
};

const routeDescriptions: Record<WorkRoute, string> = {
  weekly_report: "汇总本周工单、提交和进度，生成结构化周报",
  meeting_minutes: "上传录音文件 → 转写 → 摘要 → 审核发布",
  project_progress: "聚合项目维度的工单/Git/知识库数据，生成汇总报告",
  coding: "创建 Pi Session 执行代码变更，Diff 和测试结果可审核",
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
  children,
}: WorkDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // -- Goal 输入 + 路由分诊 (支持用户锁定路由或自动分诊) --
  const [goalInput, setGoalInput] = useState<string>(() => defaultGoal ?? "");
  const autoRoute = useMemo(() => routeWorkGoal(goalInput), [goalInput]);
  const route = selectedRouteOverride ?? autoRoute;

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
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);

  // -- HIL 审批 --
  const [pendingApproval, setPendingApproval] = useState<{
    runId: string;
    callId: string;
    tool: string;
    args: unknown;
    reason: string;
  } | null>(null);

  // -- 选中的任务详情 --
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

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
          callId: payload.callId ?? "",
          tool: payload.tool ?? "",
          args: payload.args ?? {},
          reason: payload.reason ?? "需要用户审批",
        });
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
      const currentRoute = selectedRouteOverride ?? routeWorkGoal(rawInput);

      // ── weekly_report: 调用现有 /api/ai/workflows ──
      if (currentRoute === "weekly_report") {
        setIsRunning(true);
        setLastResult(null);
        try {
          const now = new Date();
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
          monday.setHours(0, 0, 0, 0);
          const sunday = new Date(monday);
          sunday.setDate(monday.getDate() + 6);
          sunday.setHours(23, 59, 59, 999);

          const res = await fetch("/api/ai/workflows", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflowType: "weekly_report",
              weekStart: monday.toISOString(),
              weekEnd: sunday.toISOString(),
            }),
          });
          const json = await res.json();
          if (!res.ok || json.error) {
            setLastResult({
              runId: "",
              status: "failed",
              taskType: "workflow",
              error: json.error ?? "启动失败",
            });
          } else if (json.data?.skipped) {
            setLastResult({
              runId: json.data.existingRunId ?? "",
              status: "skipped",
              taskType: "workflow",
              error: "已有相同类型的工作流正在运行",
            });
          } else {
            setLastResult({
              runId: json.data.runId,
              status: "running",
              taskType: "workflow",
              workflowName: "周报",
            });
            setSelectedItem({
              id: `WorkflowRun-${json.data.runId}`,
              kind: "weekly_report",
              source: "WorkflowRun",
              sourceId: json.data.runId,
              status: "running",
              title: "周报生成",
              updatedAt: new Date().toISOString(),
            });
            setRefreshKey((k) => k + 1);
          }
        } catch (err) {
          setLastResult({
            runId: "",
            status: "failed",
            taskType: "workflow",
            error: err instanceof Error ? err.message : "网络错误",
          });
        } finally {
          setIsRunning(false);
        }
        return;
      }

      // ── meeting_minutes: 直接在 Work 面板内启动会议纪要完整工作流 ──
      if (currentRoute === "meeting_minutes") {
        setSelectedItem({
          id: `new-meeting-${Date.now()}`,
          kind: "meeting_minutes",
          source: "ProjectMeeting",
          sourceId: "",
          status: "UPLOADING",
          title: rawInput || "新建会议纪要",
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      // ── project_progress: 调用 /api/ai/workflows ──
      if (currentRoute === "project_progress") {
        setIsRunning(true);
        setLastResult(null);
        try {
          const res = await fetch("/api/ai/workflows", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflowType: "project-progress",
            }),
          });
          const json = await res.json();
          if (!res.ok || json.error) {
            setLastResult({
              runId: "",
              status: "failed",
              taskType: "workflow",
              error: json.error ?? "启动失败",
            });
          } else if (json.data?.skipped) {
            setLastResult({
              runId: json.data.existingRunId ?? "",
              status: "skipped",
              taskType: "workflow",
              error: "已有相同类型的工作流正在运行",
            });
          } else {
            setLastResult({
              runId: json.data.runId,
              status: "completed",
              taskType: "workflow",
              workflowName: "项目进展汇总",
              summary: "项目进展汇总已生成",
            });
            setSelectedItem({
              id: `WorkflowRun-${json.data.runId}`,
              kind: "project_progress",
              source: "WorkflowRun",
              sourceId: json.data.runId,
              status: "completed",
              title: "项目进展汇总",
              updatedAt: new Date().toISOString(),
            });
            setRefreshKey((k) => k + 1);
          }
        } catch (err) {
          setLastResult({
            runId: "",
            status: "failed",
            taskType: "workflow",
            error: err instanceof Error ? err.message : "网络错误",
          });
        } finally {
          setIsRunning(false);
        }
        return;
      }

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
            taskType: "coding",
            summary: "Pi Coding Session 执行中...",
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

  const handleApprove = useCallback(async () => {
    if (!pendingApproval) return;
    try {
      const res = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: pendingApproval.runId,
          callId: pendingApproval.callId,
          decision: "approve",
        }),
      });
      if (!res.ok) throw new Error("审批失败");
      setPendingApproval(null);
    } catch (error) {
      alert(`审批失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [pendingApproval]);

  const handleDeny = useCallback(async () => {
    if (!pendingApproval) return;
    try {
      const res = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: pendingApproval.runId,
          callId: pendingApproval.callId,
          decision: "deny",
        }),
      });
      if (!res.ok) throw new Error("拒绝失败");
      setPendingApproval(null);
      setIsStreaming(false);
      setIsRunning(false);
      setLastResult((prev) => ({
        ...prev!,
        status: "cancelled",
        summary: "用户拒绝了工具调用",
      }));
    } catch (error) {
      alert(`拒绝失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [pendingApproval]);

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

  // ─── SSE 事件渲染 ────────────────────────────────────────────────────────────

  const renderEventCard = (record: SSERecord) => {
    const icons: Record<string, string> = {
      pi_run_started: "🚀",
      pi_session_started: "💻",
      pi_assistant_message: "🤖",
      pi_tool_call: "🔧",
      pi_tool_result: "✅",
      pi_progress: "⏳",
      pi_run_completed: "🎉",
      pi_error: "❌",
      dispatch_result: "🔀",
    };
    const icon = icons[record.type] ?? "📋";
    let content = "";
    const payload = record.payload as Record<string, unknown>;
    if (record.type === "pi_tool_call") {
      const argsStr = JSON.stringify(payload.args ?? {}).slice(0, 50);
      content = `调用 ${payload.tool}(${argsStr}...)`;
    } else if (record.type === "pi_assistant_message") {
      content = ((payload as { content?: string }).content ?? "").slice(0, 100);
    } else if (record.type === "pi_session_started") {
      content = `Pi Session 已启动 (${payload?.piSessionId ?? ""})`;
    } else if (record.type === "dispatch_result") {
      content = `识别为 ${payload.taskType} 任务`;
    } else {
      content = (payload as { message?: string }).message ?? record.type;
    }
    return (
      <div
        key={record.id}
        className="flex items-start gap-2 rounded-md bg-white p-2 text-xs shadow-sm"
      >
        <span>{icon}</span>
        <span className="flex-1 break-all text-ink-600">{content}</span>
      </div>
    );
  };

  const allRuns = workItems.slice(0, 15);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const mainPanel = (
    <div className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden bg-white">
        {/* 头部 (固定) */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-ink-900">Work</p>
              <p className="text-xs text-ink-500">交付可审核产物</p>
            </div>
          </div>
          {onSwitchToConversation && (
            <button
              onClick={onSwitchToConversation}
              className="rounded-md px-2.5 py-1.5 text-xs text-ink-600 transition-colors hover:bg-ink-100"
            >
              切换到 Chat
            </button>
          )}
        </div>

        {/* 执行模型选择栏 (固定) */}
        <div className="flex flex-shrink-0 flex-col gap-1.5 border-b border-ink-200 bg-white/90 px-5 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-600">执行模型</span>
            <span className="text-[11px] text-ink-400">点击切换模型</span>
          </div>
          <ModelSelector
            value={selectedModel}
            onChange={(model) => {
              setSelectedModel(model);
              localStorage.setItem("preferredModel", model);
              localStorage.setItem("preferredModel_work", model);
            }}
            category="chat"
            fullWidth
            align="full"
          />
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
              placeholder="例如：生成本周周报 / 帮我重构 ticket 模块"
              className="min-h-20 w-full rounded-lg border border-ink-300 bg-white p-3 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              disabled={isRunning}
            />
            <div className="space-y-1.5 pt-0.5">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-ink-500">
                  目标路由：
                  <span className="font-semibold text-brand-600">
                    {routeLabels[route]}
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
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    selectedRouteOverride === null
                      ? "bg-brand-600 text-white shadow-2xs"
                      : "border border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:bg-brand-50/50"
                  }`}
                >
                  自动
                </button>
                {/* 4 个具体路由按钮 */}
                {(
                  [
                    "weekly_report",
                    "project_progress",
                    "meeting_minutes",
                    "coding",
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
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                        isExplicitActive
                          ? "bg-brand-600 text-white shadow-2xs"
                          : "border border-ink-200 bg-white text-ink-600 hover:border-brand-300 hover:bg-brand-50/50"
                      }`}
                    >
                      {routeLabels[r]}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-ink-400 pt-0.5">
                说明：{routeDescriptions[route]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void submitGoal()}
              disabled={!goalInput.trim() || isRunning}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? "执行中…" : "创建任务"}
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
                          onClick={() => setSelectedItem(item)}
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
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-700"
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
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-300 bg-white px-3.5 py-2 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
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
            {isStreaming && (
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-brand-700">
                    🔄 执行中…
                  </p>
                  <button
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
                    className="text-xs text-danger-600 hover:text-danger-700"
                  >
                    停止
                  </button>
                </div>
                {lastResult?.piOutput && (
                  <div className="mb-3 whitespace-pre-wrap rounded-md border border-brand-300 bg-white p-3 font-mono text-xs text-ink-700">
                    <p className="mb-1 text-xs font-medium text-brand-700">
                      🤖 Pi 输出:
                    </p>
                    {lastResult.piOutput}
                  </div>
                )}
                <div className="space-y-2">
                  {realtimeEvents.map(renderEventCard)}
                </div>
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
                    需要审批
                  </p>
                </div>
                <div className="mb-3 space-y-1 text-sm text-warning-900">
                  <p>
                    <strong>工具:</strong> {pendingApproval.tool}
                  </p>
                  <p>
                    <strong>参数:</strong>
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded bg-warning-100 p-2 text-xs">
                    {JSON.stringify(pendingApproval.args, null, 2)}
                  </pre>
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
          /* 空状态 → 引导 */
          <div className="my-auto flex min-h-full w-full flex-1 flex-col items-center justify-center p-8 text-center text-ink-500">
            <div className="mx-auto max-w-md py-8">
              <svg
                className="mx-auto mb-4 h-16 w-16 text-ink-200"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              <p className="text-lg font-semibold text-ink-800">
                告诉 Work 你想完成什么
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-400">
                输入目标后，系统会自动分诊到周报生成、会议纪要、项目汇总或
                Coding 路由。
                <br />
                写入和高风险操作会在执行前进入审批。
              </p>
              {onSwitchToConversation && (
                <button
                  type="button"
                  onClick={onSwitchToConversation}
                  className="mt-6 inline-flex items-center gap-1.5 rounded-xl border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-all hover:border-ink-400 hover:bg-ink-50"
                >
                  切换到 Chat 模式
                </button>
              )}
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
                  <span>最佳方案路线:</span>
                </span>
                <span className="rounded bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800">
                  推荐置信度: {routeData?.confidence || "60%"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {routeData?.bestRouteSteps &&
                routeData.bestRouteSteps.length > 0 ? (
                  routeData.bestRouteSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-900 shadow-2xs">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] text-white">
                          {idx + 1}
                        </span>
                        <span>{step}</span>
                      </span>
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
                  支持自由组合工作流
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
                          : "border-ink-200 bg-white opacity-70 hover:border-ink-300 hover:opacity-100"
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
                          <span className="font-mono text-[11px] font-semibold text-brand-600">
                            ({cap.command})
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
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
                <span className="text-[11px] text-ink-400">
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
                        className="rounded-xl border border-ink-200 bg-ink-50/60 p-3.5 text-xs transition hover:border-brand-300"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-ink-200/60 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                              {step.index}
                            </span>
                            <span className="font-bold text-ink-900">
                              [{step.title}]
                            </span>
                          </div>
                          <span className="rounded border border-ink-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-700">
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
                              className="mt-1 min-h-16 w-full rounded-lg border border-ink-200 bg-white p-2.5 text-xs leading-relaxed text-ink-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
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
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2 text-xs font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
            >
              <span>🚀 确认并启动 Pi 会话</span>
            </button>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="rounded-xl border border-ink-300 bg-white px-4 py-2 text-xs font-medium text-ink-700 transition hover:bg-ink-50"
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
