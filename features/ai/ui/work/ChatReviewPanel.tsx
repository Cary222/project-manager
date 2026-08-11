"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowDraft } from "@/features/ai/agents/work/workflows/weekly-report/state";

// ============================================================================
// Types
// ============================================================================

export interface ReviewMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/** 内嵌在 assistant 消息气泡里的交互动作卡片 */
export interface MessageAction {
  type: "approve" | "revise" | "generate" | "cancel";
  status: "pending" | "loading" | "done" | "error";
  error?: string;
}

export interface AssistantMessage extends ReviewMessage {
  role: "assistant";
  action?: MessageAction;
}

function isAssistantMsg(msg: ReviewMessage): msg is AssistantMessage {
  return msg.role === "assistant";
}

export interface ChatReviewPanelProps {
  workflowRunId: string;
  draft: WorkflowDraft | null;
  /** messages extracted from workflow history */
  messages: ReviewMessage[];
  onApproved?: (reportId: string) => void;
  onCancelled?: () => void;
}

// ============================================================================
// Draft preview
// ============================================================================

function DraftPreview({
  draft,
  revisionCount,
}: {
  draft: ChatReviewPanelProps["draft"];
  revisionCount: number;
}) {
  if (!draft) return null;

  const hasHighlights = (draft.highlights?.length ?? 0) > 0;
  const hasTasks = (draft.tasks?.length ?? 0) > 0;
  const hasNextPlan = (draft.nextPlan?.length ?? 0) > 0;
  const hasMarkdown = Boolean(draft.rawMarkdown?.trim());
  const hasProjects = (draft.projectNames?.length ?? 0) > 0;
  const hasContent = hasHighlights || hasTasks || hasNextPlan || hasMarkdown || hasProjects;

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-medium text-brand-700">周报草稿</h4>
        {revisionCount > 0 && (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-600">
            第 {revisionCount} 轮修改
          </span>
        )}
      </div>

      {hasMarkdown ? (
        <div
          className="prose prose-sm max-w-none whitespace-pre-wrap text-ink-700"
          dangerouslySetInnerHTML={{
            __html: draft.rawMarkdown
              .replace(/^## /gm, "<br/><strong>")
              .replace(/(<strong>.*<\/strong>)/g, "$1")
              .replace(/^- /gm, "• "),
          }}
        />
      ) : !hasContent ? (
        <div className="space-y-2 text-sm text-ink-400">
          {draft._error ? (
            <p className="text-red-600">修改失败：{draft._error}</p>
          ) : (
            <>
              <p>本周暂无工单或活动记录，草稿为空。</p>
              <p className="text-xs">可以告诉 AI 你本周做了什么，AI 会根据你的描述生成周报。</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {hasProjects && (
            <div>
              <p className="text-xs font-medium text-brand-600">本周参与项目</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.projectNames.map((name, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs text-brand-700"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {hasHighlights && (
            <div>
              <p className="text-xs font-medium text-brand-600">本周重点</p>
              <ul className="ml-3 list-disc text-sm text-ink-700">
                {draft.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}
          {hasTasks && (
            <div>
              <p className="text-xs font-medium text-brand-600">完成任务</p>
              <ul className="ml-3 list-disc text-sm text-ink-700">
                {draft.tasks.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {hasNextPlan && (
            <div>
              <p className="text-xs font-medium text-brand-600">下周计划</p>
              <ul className="ml-3 list-disc text-sm text-ink-700">
                {draft.nextPlan.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Approve card with feedback input for revise
// ============================================================================

function ApproveCard({
  isLoading,
  isDone,
  isError,
  error,
  onAction,
}: {
  isLoading: boolean;
  isDone: boolean;
  isError: boolean;
  error?: string;
  onAction: (type: MessageAction["type"], feedback?: string) => void;
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");

  const handleRevise = () => {
    console.log("[ApproveCard.handleRevise] called", { feedback, isLoading });
    if (!feedback.trim() || isLoading) {
      console.log("[ApproveCard.handleRevise] blocked: empty feedback or isLoading");
      return;
    }
    console.log("[ApproveCard.handleRevise] calling onAction with:", feedback.trim());
    onAction("revise", feedback.trim());
    setShowFeedback(false);
    setFeedback("");
  };

  return (
    <div className="mt-3 rounded-lg border border-brand-200 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs text-ink-500">请确认草稿内容无误后，点击下方按钮生成周报。</p>
      {showFeedback ? (
        <div className="space-y-2">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="告诉 AI 你想怎么修改，例如：加上更多细节、调整格式…"
            rows={3}
            autoFocus
            disabled={isLoading}
            className="w-full resize-none rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-700 placeholder:text-ink-300 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRevise}
              disabled={isLoading || !feedback.trim()}
              className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              {isLoading ? "重新生成中..." : "重新生成"}
            </button>
            <button
              onClick={() => { setShowFeedback(false); setFeedback(""); }}
              disabled={isLoading}
              className="rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onAction("approve")}
            disabled={isLoading || isDone}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {isLoading ? "确认中..." : isDone ? "✓ 已确认" : "✓ 确认生成"}
          </button>
          <button
            onClick={() => setShowFeedback(true)}
            disabled={isLoading || isDone}
            className="rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
          >
            修改草稿
          </button>
          <button
            onClick={() => onAction("cancel")}
            disabled={isLoading || isDone}
            className="rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
          >
            取消
          </button>
        </div>
      )}
      {isError && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

// ============================================================================
// Message bubble
// ============================================================================

function ActionCard({
  action,
  msgId,
  onAction,
}: {
  action: MessageAction;
  msgId: string;
  onAction: (type: MessageAction["type"], msgId: string, feedback?: string) => void;
}) {
  const isLoading = action.status === "loading";
  const isDone = action.status === "done";
  const isError = action.status === "error";

  if (action.type === "approve") {
    return (
      <ApproveCard
        isLoading={isLoading}
        isDone={isDone}
        isError={isError}
        error={action.error}
        onAction={(type, feedback) => onAction(type, msgId, feedback)}
      />
    );
  }

  if (action.type === "generate") {
    return (
      <div className="mt-3 rounded-lg border border-brand-200 bg-white p-3 shadow-sm">
        <p className="mb-2 text-xs text-ink-500">确认后即可将周报写入系统。</p>
        <div className="flex gap-2">
          <button
            onClick={() => onAction("generate", msgId)}
            disabled={isLoading || isDone}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            {isLoading ? "写入中..." : isDone ? "✓ 已生成" : "✓ 一键生成周报"}
          </button>
          <button
            onClick={() => onAction("cancel", msgId)}
            disabled={isLoading || isDone}
            className="rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
          >
            取消
          </button>
        </div>
        {isError && (
          <p className="mt-2 text-xs text-red-600">{action.error}</p>
        )}
      </div>
    );
  }

  return null;
}

function MessageBubble({
  message,
  onAction,
}: {
  message: ReviewMessage;
  onAction?: (type: MessageAction["type"], msgId: string, feedback?: string) => void;
}) {
  const isUser = message.role === "user";
  const assistantMsg = isAssistantMsg(message) ? message : null;

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isUser
            ? "rounded-br-md bg-brand-600 text-white"
            : "rounded-bl-md bg-ink-100 text-ink-800"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <p
          className={`mt-1 text-xs ${
            isUser ? "text-brand-200" : "text-ink-400"
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      {/* ActionCard 接收 msgId */}
      {assistantMsg?.action && onAction && (
        <ActionCard
          action={assistantMsg.action}
          msgId={message.id}
          onAction={onAction}
        />
      )}
    </div>
  );
}

// ============================================================================
// ChatReviewPanel
// ============================================================================

/** 生成一个带 action 的 assistant 消息 */
function makeAssistantMsg(
  content: string,
  actionType: MessageAction["type"],
  actionStatus: MessageAction["status"] = "pending",
  error?: string
): AssistantMessage {
  return {
    id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    action: { type: actionType, status: actionStatus, error },
  };
}

/** 更新消息列表中指定 id 的 action 状态，返回新列表 */
function updateMessageAction(
  msgs: ReviewMessage[],
  msgId: string,
  status: MessageAction["status"],
  error?: string
): ReviewMessage[] {
  return msgs.map((m) => {
    if (m.id !== msgId || !isAssistantMsg(m)) return m;
    return { ...m, action: { ...m.action!, status, error } } as AssistantMessage;
  });
}

export function ChatReviewPanel({
  workflowRunId,
  draft,
  messages: initialMessages,
  onApproved,
  onCancelled,
}: ChatReviewPanelProps) {
  const [messages, setMessages] = useState<ReviewMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── 注入初始 approve 气泡（draft 首次出现时，父组件轮询到草稿后自动触发）──
  // draft 每次因 revise 而更新内容时（highlights/tasks/nextPlan/rawMarkdown/_error 任一变化），
  // 都要移除旧的待确认气泡并注入一条新的，而不是重复叠加。
  const draftInjectedRef = useRef(false);
  const lastDraftKeyRef = useRef<string>("");

  useEffect(() => {
    if (!draft) return;
    const draftKey = JSON.stringify(draft);
    if (draftKey === lastDraftKeyRef.current) return;

    const isFirstDraft = lastDraftKeyRef.current === "";
    lastDraftKeyRef.current = draftKey;
    draftInjectedRef.current = true;

    const msg = makeAssistantMsg(
      "周报草稿已生成，请确认内容无误后点击下方按钮生成周报：",
      "approve",
      "pending"
    );

    setMessages((prev) => {
      // 移除旧的待确认气泡（如果是 revise 更新而不是首次出现）
      const withoutOldPending = isFirstDraft
        ? prev
        : prev.filter(
            (m) => !(isAssistantMsg(m) && m.action?.type === "approve" && m.action.status === "pending")
          );
      return [...withoutOldPending, msg];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // ── 所有 action（approve / revise / cancel）的统一处理器 ──────────────────
  const handleAction = useCallback(
    async (type: MessageAction["type"], msgId: string, feedback?: string) => {
      console.log("[handleAction] called", { type, msgId, feedback });
      if (messages.some((m) => isAssistantMsg(m) && m.action?.status === "loading")) {
        console.log("[handleAction] blocked: another action is loading");
        return;
      }

      setMessages((prev) => updateMessageAction(prev, msgId, "loading"));
      setError(null);

      try {
        if (type === "approve") {
          const res = await fetch(`/api/ai/workflows/${workflowRunId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve" }),
          });
          const json = await res.json();
          if (!res.ok || json.error) {
            setMessages((prev) => updateMessageAction(prev, msgId, "error", json.error ?? "确认失败"));
            return;
          }
          setMessages((prev) => updateMessageAction(prev, msgId, "done"));
        } else if (type === "generate") {
          // Read prefill data from snapshot and call generate-from-workflow API
          const res = await fetch(`/api/ai/workflows/${workflowRunId}`);
          const json = await res.json();
          if (!res.ok || json.error) {
            setMessages((prev) => updateMessageAction(prev, msgId, "error", json.error ?? "获取草稿失败"));
            return;
          }
          const prefill = json.data?.snapshot?.values;
          if (!prefill?.prefillTitle || !prefill?.prefillWeekStart || !prefill?.prefillWeekEnd) {
            setMessages((prev) => updateMessageAction(prev, msgId, "error", "草稿数据不完整"));
            return;
          }
          const generateRes = await fetch("/api/reports/weekly-reports/generate-from-workflow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflowRunId,
              weekStart: prefill.prefillWeekStart,
              weekEnd: prefill.prefillWeekEnd,
              title: prefill.prefillTitle,
              content: prefill.prefillContent ?? "",
              projectIds: prefill.prefillProjectIds ?? [],
            }),
          });
          const generateJson = await generateRes.json();
          if (!generateRes.ok || generateJson.error) {
            setMessages((prev) => updateMessageAction(prev, msgId, "error", generateJson.error ?? "生成失败"));
            return;
          }
          setMessages((prev) => updateMessageAction(prev, msgId, "done"));
          onApproved?.(generateJson.reportId);
        } else if (type === "revise") {
          // Send message-style feedback to trigger revise round
          const res = await fetch(`/api/ai/workflows/${workflowRunId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "message", message: feedback }),
          });
          const json = await res.json();
          if (!res.ok || json.error) {
            setMessages((prev) => updateMessageAction(prev, msgId, "error", json.error ?? "重新生成失败"));
            return;
          }
          setMessages((prev) => updateMessageAction(prev, msgId, "done"));
        } else if (type === "cancel") {
          const res = await fetch(`/api/ai/workflows/${workflowRunId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel" }),
          });
          const json = await res.json();
          if (!res.ok || json.error) {
            setMessages((prev) => updateMessageAction(prev, msgId, "error", json.error ?? "取消失败"));
            return;
          }
          setMessages((prev) => updateMessageAction(prev, msgId, "done"));
          onCancelled?.();
        }
      } catch {
        setMessages((prev) => updateMessageAction(prev, msgId, "error", "网络错误，请重试"));
      }
    },
    [messages, workflowRunId, onCancelled]
  );

  // ── Chat 输入框发送 ────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isSending) return;

      const userMsg: ReviewMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };

      const msgsBeforeSend = messages;
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setError(null);
      setIsSending(true);

      try {
        const res = await fetch(`/api/ai/workflows/${workflowRunId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "message", message: text.trim() }),
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          setError(json.error ?? "发送失败");
          setMessages(msgsBeforeSend);
          return;
        }
        // 收到 AI 响应后，注入 revise 完成气泡（带 approve / generate action）
        const reviseDoneMsg = makeAssistantMsg(
          "已根据您的意见修改周报，请确认：",
          "approve",
          "pending"
        );
        setMessages((prev) => [...prev, reviseDoneMsg]);
      } catch {
        setError("网络错误，请重试");
        setMessages(msgsBeforeSend);
      } finally {
        setIsSending(false);
      }
    },
    [messages, workflowRunId, isSending]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage(input);
      }
    },
    [input, sendMessage]
  );

  const revisionCount = messages.filter(
    (m) => m.role === "assistant" && m.content.includes("已根据您的意见修改")
  ).length;

  return (
    <div className="flex flex-col" style={{ height: 520 }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-brand-600"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-ink-900">审阅周报</p>
            <p className="text-xs text-ink-400">告诉 AI 如何调整，或点击按钮确认生成</p>
          </div>
        </div>
      </div>

      {/* Scroll area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Draft preview */}
        {draft && <DraftPreview draft={draft} revisionCount={revisionCount} />}

        {/* Messages + action bubbles */}
        {messages.length > 0 && (
          <div className="mt-4 space-y-3">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onAction={
                  isAssistantMsg(msg) && msg.action?.status === "pending"
                    ? (type, msgId, feedback) => handleAction(type, msgId, feedback)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !draft && (
          <div className="flex h-24 items-center justify-center text-sm text-ink-400">
            等待 AI 生成草稿...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Always-visible chat input */}
      <div className="border-t border-ink-200 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="告诉 AI 如何调整周报...（Enter 发送，Shift+Enter 换行）"
            rows={2}
            disabled={isSending}
            className="flex-1 resize-none rounded-lg border border-ink-300 px-3 py-2 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
          />
          <button
            onClick={() => void sendMessage(input)}
            disabled={!input.trim() || isSending}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            title="发送"
          >
            {isSending ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
