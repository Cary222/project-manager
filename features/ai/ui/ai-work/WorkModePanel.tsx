"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkflowLauncher } from "./WorkflowLauncher";
import { WorkflowStatusCard } from "./WorkflowStatusCard";

interface WorkflowRun {
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

interface WorkModePanelProps {
  /** Callback when switching back to conversation mode */
  onSwitchToConversation?: () => void;
  /** Callback when user clicks "查看" on a run */
  onSelectRun?: (runId: string, conversationId?: string) => void;
  /** Callback when user wants to start a conversation */
  onStartConversation?: () => void;
}

interface WorkAgentRunResult {
  runId: string;
  status: string;
  taskType: "workflow" | "coding" | "unknown";
  workflowType?: string;
  workflowName?: string;
  summary?: string | null;
  error?: string | null;
  piOutput?: string; // Pi SDK 累积输出文本
}

interface SSERecord {
  id: number;
  type: string;
  payload: unknown;
  timestamp: number;
}

export function WorkModePanel({ onSelectRun }: WorkModePanelProps) {
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Work Agent 自然语言输入
  const [taskInput, setTaskInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<WorkAgentRunResult | null>(null);

  // SSE streaming 状态
  const [isStreaming, setIsStreaming] = useState(false);
  const [realtimeEvents, setRealtimeEvents] = useState<SSERecord[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventIdRef = useRef(0);
  
  // HIL 审批状态（Phase 3）
  const [pendingApproval, setPendingApproval] = useState<{
    runId: string;
    callId: string;
    tool: string;
    args: unknown;
    reason: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/ai/workflows?kind=RUN&limit=20");
        if (res.ok && !cancelled) {
          const json = await res.json();
          setWorkflowRuns(json.data ?? []);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // 立即生成后：刷新列表 + 自动展开对应工作流的详情面板（不切到对话页）
  const handleWorkflowLaunched = useCallback((_runId: string, _conversationId?: string) => {
    setRefreshKey((k) => k + 1);
    if (_runId) {
      onSelectRun?.(_runId, _conversationId);
    }
  }, [onSelectRun]);

  const handleDeleted = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // SSE 事件处理器
  const handleSSEEvent = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      console.log("[WorkModePanel] Received SSE event:", data.type, data.payload);
      
      const record: SSERecord = {
        id: eventIdRef.current++,
        type: data.type,
        payload: data.payload,
        timestamp: Date.now(),
      };

      setRealtimeEvents((prev) => {
        const updated = [...prev, record];
        // 保留最近 10 条事件
        return updated.slice(-10);
      });

      // 处理 Pi SDK 的 assistant_message 事件（文本输出）
      // payload 结构: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '文字', content: '完整文本' } }
      if (data.type === "pi_assistant_message") {
        console.log("[WorkModePanel] Processing pi_assistant_message:", data.payload);
        const payload = data.payload as {
          assistantMessageEvent?: {
            content?: string;
            delta?: string;
            type?: string;
          };
        };
        const text = payload?.assistantMessageEvent?.content ?? payload?.assistantMessageEvent?.delta ?? "";
        if (text) {
          console.log("[WorkModePanel] Appending text:", text);
          setLastResult((prev) => ({
            ...prev!,
            piOutput: (prev?.piOutput ?? "") + text,
          }));
        }
      }

      // 如果是 approval_required，触发审批弹窗
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

      // 如果是 run_completed，更新最终状态
      if (data.type === "pi_run_completed") {
        setIsStreaming(false);
        setIsRunning(false);
        setPendingApproval(null);
        
        // 尝试从 payload 中提取最终文本
        // payload 结构: { message: { content: [{ text: '完整文本' }] } }
        let finalText = "";
        const payload = data.payload as {
          message?: {
            content?: Array<{ text?: string }>;
          };
          runId?: string;
        };
        
        if (payload?.message?.content && Array.isArray(payload.message.content)) {
          finalText = payload.message.content
            .map((c) => c.text ?? "")
            .join("");
        }
        
        console.log("[WorkModePanel] pi_run_completed, finalText:", finalText.substring(0, 100));
        
        setLastResult((prev) => ({
          ...prev!,
          runId: payload?.runId ?? prev?.runId ?? "",
          status: "completed",
          // 优先使用流式累积的文本，其次使用最终文本，最后使用默认消息
          summary: prev?.piOutput || finalText || "Pi 任务已完成",
          piOutput: prev?.piOutput || finalText,
        }));
      }

      // 如果是 error，更新错误状态
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
      // ignore parse errors
    }
  }, []);

  // Work Agent 自然语言任务启动（支持 SSE streaming）
  const handleRunTask = useCallback(async () => {
    if (!taskInput.trim() || isRunning) return;

    // 清理之前的资源
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

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
      // 创建新的 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Phase 2: 使用 fetch + ReadableStream 替代 EventSource
      // 因为 POST 请求不支持 EventSource
      const response = await fetch("/api/ai/work/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: taskInput }),
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

      // 检查是否是 SSE
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        // SSE 模式：流式处理事件
        setIsStreaming(true);

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("无法读取响应流");
        }

        // 保存 reader 引用以便取消
        readerRef.current = reader;

        const decoder = new TextDecoder();
        let buffer = "";

        // 读取流
        const readStream = async () => {
          try {
            while (true) {
              // 检查是否已取消
              if (abortController.signal.aborted) {
                break;
              }

              const { done, value } = await reader.read();
              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const jsonStr = line.slice(6);
                  try {
                    JSON.parse(jsonStr); // validate JSON
                    handleSSEEvent({
                      data: jsonStr,
                    } as MessageEvent);
                  } catch {
                    // ignore parse errors
                  }
                }
              }
            }
          } catch (error) {
            // stream ended or aborted
            if (error instanceof Error && error.name !== "AbortError") {
              console.error("Stream read error:", error);
              setLastResult({
                runId: "",
                status: "failed",
                taskType: "coding",
                error: error.message,
              });
            }
          } finally {
            // 清理资源
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
            readerRef.current = null;
            setIsStreaming(false);
            setIsRunning(false);
          }
        };

        void readStream();

        // 初始化结果（会在事件处理中更新）
        setLastResult({
          runId: "",
          status: "running",
          taskType: "coding",
          summary: "Pi Coding Session 执行中...",
        });
      } else {
        // 普通 JSON 模式（workflow 类任务）
        const json = await response.json();
        const result = json.data as WorkAgentRunResult;
        setLastResult(result);

        // 如果是 workflow 任务，刷新列表
        if (result.taskType === "workflow") {
          setRefreshKey((k) => k + 1);
        }
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
  }, [taskInput, isRunning, handleSSEEvent]);
  
  // HIL 审批处理函数（Phase 3）
  const handleApprove = useCallback(async () => {
    if (!pendingApproval) return;
    
    try {
      // TODO: 调用 API 发送审批决策
      const response = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: pendingApproval.runId,
          callId: pendingApproval.callId,
          decision: "approve",
        }),
      });
      
      if (!response.ok) {
        throw new Error("审批失败");
      }
      
      // 清除待审批状态
      setPendingApproval(null);
    } catch (error) {
      console.error("Approval failed:", error);
      alert(`审批失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [pendingApproval]);
  
  const handleDeny = useCallback(async () => {
    if (!pendingApproval) return;
    
    try {
      // TODO: 调用 API 发送拒绝决策
      const response = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: pendingApproval.runId,
          callId: pendingApproval.callId,
          decision: "deny",
        }),
      });
      
      if (!response.ok) {
        throw new Error("拒绝操作失败");
      }
      
      // 清除待审批状态，停止运行
      setPendingApproval(null);
      setIsStreaming(false);
      setIsRunning(false);
      setLastResult((prev) => ({
        ...prev!,
        status: "cancelled",
        summary: "用户拒绝了工具调用",
      }));
    } catch (error) {
      console.error("Deny failed:", error);
      alert(`拒绝操作失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [pendingApproval]);

  // 清理所有 SSE 资源 on unmount
  useEffect(() => {
    const es = eventSourceRef.current;
    const reader = readerRef.current;
    const controller = abortControllerRef.current;
    
    return () => {
      if (es) {
        es.close();
      }
      if (reader) {
        reader.cancel().catch(() => {});
      }
      if (controller) {
        controller.abort();
      }
    };
  }, []);

  const allRuns = workflowRuns.slice(0, 10);

  // 渲染 SSE 事件卡片
  const renderEventCard = (record: SSERecord) => {
    const { type, payload } = record;
    let icon = "📋";
    let color = "text-ink-600";
    let content = "";

    if (type === "pi_run_started") {
      icon = "🚀";
      color = "text-brand-600";
      content = "Pi Session 已启动";
    } else if (type === "pi_assistant_message") {
      icon = "🤖";
      color = "text-ink-700";
      const msg = payload as { content?: string };
      content = msg.content?.slice(0, 100) ?? "";
    } else if (type === "pi_tool_call") {
      icon = "🔧";
      color = "text-warning-600";
      const tool = payload as { tool?: string; args?: Record<string, unknown> };
      const argsStr = JSON.stringify(tool.args ?? {}).slice(0, 50);
      content = `调用 ${tool.tool}(${argsStr}...)`;
    } else if (type === "pi_tool_result") {
      icon = "✅";
      color = "text-success-600";
      const result = payload as { success?: boolean };
      content = result.success ? "工具执行成功" : "工具执行失败";
    } else if (type === "pi_progress") {
      icon = "⏳";
      color = "text-brand-500";
      const progress = payload as { message?: string; percent?: number };
      content = progress.message ?? "";
    } else if (type === "pi_run_completed") {
      icon = "🎉";
      color = "text-success-600";
      const result = payload as { result?: { summary?: string } };
      content = result.result?.summary ?? "任务完成";
    } else if (type === "pi_error") {
      icon = "❌";
      color = "text-danger-600";
      const error = payload as { message?: string };
      content = error.message ?? "未知错误";
    } else if (type === "dispatch_result") {
      icon = "🔀";
      color = "text-brand-500";
      const dispatch = payload as { taskType?: string };
      content = `识别为 ${dispatch.taskType} 任务`;
    }

    return (
      <div
        key={record.id}
        className={`flex items-start gap-2 rounded-md bg-white p-2 text-xs shadow-sm ${color}`}
      >
        <span>{icon}</span>
        <span className="flex-1 break-all">{content}</span>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 px-6 py-4">
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
            <p className="font-semibold text-ink-900">工作模式</p>
            <p className="text-xs text-ink-500">发起和管理任务工作流</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Work Agent 自然语言输入 */}
        <section className="mb-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Work Agent（自然语言任务）
          </h2>
          <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-sm">
            <div className="flex gap-3">
              <input
                type="text"
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleRunTask();
                  }
                }}
                placeholder="输入任务描述，如：帮我生成周报 / 重构 ticket 模块"
                className="flex-1 rounded-md border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                disabled={isRunning}
              />
              <button
                onClick={handleRunTask}
                disabled={isRunning || !taskInput.trim()}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? "执行中..." : "执行"}
              </button>
            </div>

            {/* 执行结果提示 */}
            {lastResult && !isStreaming && (
              <div className={`mt-3 rounded-md border p-3 text-sm ${
                lastResult.status === "failed"
                  ? "border-danger-300 bg-danger-50 text-danger-900"
                  : lastResult.status === "completed"
                    ? "border-success-300 bg-success-50 text-success-900"
                    : lastResult.taskType === "coding" && lastResult.status === "pi_pending"
                      ? "border-warning-300 bg-warning-50 text-warning-900"
                      : "border-brand-300 bg-brand-50 text-brand-900"
              }`}>
                {lastResult.error && (
                  <p className="font-medium">❌ {lastResult.error}</p>
                )}
                {lastResult.summary && (
                  <p>{lastResult.summary}</p>
                )}
                {lastResult.taskType === "workflow" && lastResult.workflowName && (
                  <p>✅ 已启动工作流：{lastResult.workflowName}</p>
                )}
                {lastResult.piOutput && (
                  <div className="mt-2 whitespace-pre-wrap font-mono text-xs text-ink-700">
                    {lastResult.piOutput}
                  </div>
                )}
              </div>
            )}

            {/* SSE 实时事件流显示（coding 类任务） */}
            {isStreaming && (
              <div className="mt-3 rounded-md border border-brand-200 bg-brand-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-brand-700">🔄 Pi 执行中...</p>
                  <button
                    onClick={async () => {
                      // 停止 ReadableStream 读取
                      if (readerRef.current) {
                        await readerRef.current.cancel().catch(() => {});
                        readerRef.current = null;
                      }
                      // 中止 fetch 请求
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
                
                {/* 显示累积的 Pi 输出文本 */}
                {lastResult?.piOutput && (
                  <div className="mb-3 rounded-md border border-brand-300 bg-white p-3">
                    <p className="mb-1 text-xs font-medium text-brand-700">🤖 Pi 输出:</p>
                    <div className="whitespace-pre-wrap font-mono text-xs text-ink-700">
                      {lastResult.piOutput}
                    </div>
                  </div>
                )}
                
                <div className="space-y-2">
                  {realtimeEvents.map(renderEventCard)}
                </div>
              </div>
            )}
            
            {/* HIL 审批弹窗（Phase 3） */}
            {pendingApproval && (
              <div className="mt-3 rounded-md border-2 border-warning-400 bg-warning-50 p-4">
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
                  <p className="text-sm font-semibold text-warning-900">需要审批</p>
                </div>
                <div className="mb-3 space-y-1 text-sm text-warning-900">
                  <p><strong>工具:</strong> {pendingApproval.tool}</p>
                  <p><strong>参数:</strong></p>
                  <pre className="mt-1 overflow-x-auto rounded bg-warning-100 p-2 text-xs">
                    {JSON.stringify(pendingApproval.args, null, 2)}
                  </pre>
                  <p className="mt-2 italic">{pendingApproval.reason}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleApprove}
                    className="flex-1 rounded-md bg-success-600 px-4 py-2 text-sm font-medium text-white hover:bg-success-700"
                  >
                    ✓ 批准执行
                  </button>
                  <button
                    onClick={handleDeny}
                    className="flex-1 rounded-md bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700"
                  >
                    ✗ 拒绝
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Workflow Launcher */}
        <section className="mb-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
            快捷启动工作流
          </h2>
          <WorkflowLauncher
            onWorkflowLaunched={handleWorkflowLaunched}
            onLaunched={handleWorkflowLaunched}
          />
        </section>

        {/* All Runs */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
            工作流列表
          </h2>
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
            <div className="rounded-lg border border-dashed border-ink-300 p-8 text-center">
              <p className="text-sm text-ink-500">暂无工作流记录</p>
              <p className="mt-1 text-xs text-ink-400">发起一个工作流开始体验</p>
            </div>
          ) : (
            <div className="space-y-4">
              {allRuns.map((run) => (
                <WorkflowStatusCard
                  key={run.id}
                  run={run}
                  onDone={(runId) => onSelectRun?.(runId)}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
