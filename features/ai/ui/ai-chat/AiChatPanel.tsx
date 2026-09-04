"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AiChatInput } from "./AiChatInput";
import { AiCandidatePicker } from "./AiCandidatePicker";
import { AiMessageBubble } from "./AiMessageBubble";
import { type SourceReference } from "./AiSourcesList";
import type { ReasoningLevel } from "@/features/ai/llm/model-reasoning";
import {
  type AiMode,
  type ChatToolMode,
  type TaskRecord,
  buildStepPlan,
} from "@/features/ai/types";
import { shouldUseWebSearch } from "@/features/ai/search/detector";
import { IconSparkles, IconX } from "@/shared/ui/icons";
import { SwitchToWorkModal } from "../ai-work/SwitchToWorkModal";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * 通过服务端 IP 定位获取城市名（不依赖浏览器 geolocation）
 * 优先用于 web 搜索场景，返回代理/VPN 出口 IP 对应的城市
 */
async function getClientCity(): Promise<string | null> {
  try {
    const res = await fetch("/api/ai/geo", { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { city: string | null };
    return data.city ?? null;
  } catch {
    return null;
  }
}

function formatToolResult(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const o = output as Record<string, unknown>;
  if (o.error) return `错误: ${o.error}`;
  if (Array.isArray(o.results) && o.results.length > 0) return `找到 ${o.results.length} 条结果`;
  if (typeof o.answer === "string" && o.answer) return `已获取摘要`;
  if (Array.isArray(o.context) && o.context.length > 0) return `检索到 ${o.context.length} 条相关内容`;
  return "完成";
}

/**
 * 把 toolName 映射到 ThinkingStep 的 nodeName。
 * 工具 SSE 事件只有 toolName（searchKnowledge / searchStructured / webSearch），
 * 非工具节点通过单独的 SSE 事件标记（text / 流结束）映射。
 */
// ─── Types ───────────────────────────────────────────────────────────────────

export interface CandidateUser {
  id: string;
  /** HIL candidates: label from disambiguateIntent (e.g. "cary（刘屹鹏）") */
  label?: string;
  summary?: string;
  /** Legacy assignee format */
  name?: string;
  email?: string;
  sublabel?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  candidates?: CandidateUser[];
  /** Thinking steps snapshot — populated on done + read from DB history */
  thinkingSteps?: TaskRecord[];
  /** Total thinking duration in ms — persisted from DB for historical messages */
  totalThinkingMs?: number;
  /** 执行状态：QUEUED / PROCESSING / COMPLETED / FAILED（生图/视频模式） */
  executionStatus?: string;
  /** 附件列表（生图模式） */
  attachments?: Array<{
    id: string;
    type: string;
    fileAssetId: string;
  }>;
  /** 用户上传的参考图列表（Image 模式，用于在对话气泡中展示） */
  userImages?: Array<{
    id: string;
    url: string;
    name: string;
  }>;
  /** 进度信息（生图/视频模式） */
  progress?: {
    step: string;
    percent?: number;
    detail?: string;
  };
  /** 生成时的 loading 类型（图片/视频），用于显示正确的占位动画 */
  loadingType?: "image" | "video";
}

/** Map ThinkingNodeName → TaskCategory for placeholder tasks. */
function placeholderCategory(
  nodeName: string
): "reason" | "tool" | "workflow" | "system" | "human" {
  if (nodeName === "detectIntent" || nodeName === "decision") return "reason";
  if (
    nodeName === "searchKnowledge" ||
    nodeName === "searchStructured" ||
    nodeName === "webSearch"
  )
    return "tool";
  if (nodeName === "humanConfirmation") return "human";
  return "system";
}

/**
 * Build placeholder TaskRecords for the upcoming mode pipeline. All tasks
 * start as `running` so the timeline shows every step (including the
 * `generateResponse` step that runs last) with a visible loading spinner
 * BEFORE backend snapshots arrive. The placeholder stepLabel acts as the
 * merge key when the real snapshot overwrites it.
 */
function buildPlaceholderTasks(mode: AiMode): TaskRecord[] {
  const templates = buildStepPlan(mode);
  const now = Date.now();
  return templates.map((t, idx) => ({
    id: `placeholder-${t.nodeName}`,
    parentId: null,
    nodeName: t.nodeName,
    stepLabel: t.nodeLabel,
    title: t.nodeLabel,
    category: placeholderCategory(t.nodeName),
    status: idx === 0 ? "running" : "pending",
    startTime: idx === 0 ? now : 0,
  }));
}

interface AiChatPanelProps {
  variant?: "page" | "floating";
  conversationId?: string | null;
  onConversationCreated?: (id: string) => void;
  autoGreet?: boolean;
  onGreetingConsumed?: (id: string) => void;
  /** Switch to work mode */
  onSwitchToWorkMode?: (goal?: string, route?: string | null) => void;
  /** Switch to work mode with optional goal and target route. */
  onStartWorkflow?: (workflowType: string, goalPrompt?: string) => void;
  /** Notifies parent that the conversation no longer exists (e.g. 404). */
  onConversationMissing?: (id: string) => void;
  /** Initial message to send automatically upon mount */
  initialMessage?: string | null;
  /** Initial images attached to the initial message */
  initialImages?: { id: string; url: string; name: string }[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  aiMode?: AiMode;
  onAiModeChange?: (mode: AiMode) => void;
  chatToolMode?: ChatToolMode;
  onChatToolModeChange?: (toolMode: ChatToolMode) => void;
  thinkingLevel?: ReasoningLevel;
  onThinkingLevelChange?: (level: ReasoningLevel) => void;
  clearTrigger?: number;
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function AiChatPanel({
  variant = "page",
  conversationId,
  onConversationCreated,
  autoGreet = false,
  onGreetingConsumed,
  onSwitchToWorkMode,
  onStartWorkflow,
  onConversationMissing,
  initialMessage,
  initialImages,
  selectedModel: propSelectedModel,
  onModelChange,
  aiMode: propAiMode,
  onAiModeChange,
  chatToolMode: propChatToolMode,
  onChatToolModeChange,
  thinkingLevel: propThinkingLevel,
  onThinkingLevelChange,
  clearTrigger,
}: AiChatPanelProps) {
  const isPage = variant === "page";

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingSources, setPendingSources] = useState<SourceReference[]>([]);

  const [internalAiMode, setInternalAiMode] = useState<AiMode>("auto");
  const aiMode = propAiMode ?? internalAiMode;
  const setAiMode = useCallback(
    (mode: AiMode | ((prev: AiMode) => AiMode)) => {
      const nextMode = typeof mode === "function" ? mode(aiMode) : mode;
      setInternalAiMode(nextMode);
      onAiModeChange?.(nextMode);
    },
    [aiMode, onAiModeChange]
  );

  const [internalChatToolMode, setInternalChatToolMode] = useState<ChatToolMode>("chat");
  const chatToolMode = propChatToolMode ?? internalChatToolMode;
  const setChatToolMode = useCallback(
    (tm: ChatToolMode | ((prev: ChatToolMode) => ChatToolMode)) => {
      const nextTm = typeof tm === "function" ? tm(chatToolMode) : tm;
      setInternalChatToolMode(nextTm);
      onChatToolModeChange?.(nextTm);
    },
    [chatToolMode, onChatToolModeChange]
  );
  const [activeToolCall, setActiveToolCall] = useState<{
    toolName: string;
    displayLabel: string;
    status: "calling" | "done" | "error";
    message?: string;
  } | null>(null);
  // Pending confirmation candidates — rendered as a detached picker above the input
  // (not as a message bubble in the conversation).
  const [pendingCandidates, setPendingCandidates] = useState<CandidateUser[] | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(() => propSelectedModel ?? "agnes:agnes-2.5-flash");
  useEffect(() => {
    if (propSelectedModel && propSelectedModel !== selectedModel) {
      setSelectedModel(propSelectedModel);
    }
  }, [propSelectedModel, selectedModel]);
  useEffect(() => {
    if (clearTrigger) {
      setMessages([]);
    }
  }, [clearTrigger]);

  // Image 模式参考图 state（用于 I2I）
  const [inputFileIds, setInputFileIds] = useState<{ id: string; url: string; name: string }[]>([]);
  // Chat 模式识图 state（用于 Chat 模式下上传图片 → 后端 INPUT 附件）
  const [chatImages, setChatImages] = useState<{ id: string; url: string; name: string }[]>([]);
  // #H3 instrument: 确认 setChatImages 是否被调用（race condition 诊断）
  const setChatImagesDebug = useCallback((images: { id: string; url: string; name: string }[]) => {
    setChatImages(images);
  }, []);

  // Workflow match state: passed to parent for optimistic mode switch
  const [workflowMatch, setWorkflowMatch] = useState<{
    workflowType: string;
    workflowName: string;
    description: string;
    goalPrompt?: string;
  } | null>(null);

  // Tracks every tool call in the current stream so the UI can show a full
  // "searchKnowledge → searchStructured" pipeline instead of the last tool only.
  // Use the functional setter form to avoid stale-closure issues when SSE
  // events arrive in quick succession.
  const [toolCallChain, setToolCallChain] = useState<Array<{
    toolName: string;
    displayLabel: string;
    status: "calling" | "done" | "error";
    message?: string;
  }>>([]);
  // 完整思考流程面板：使用新的 TaskRecord 模型。
  // timelineTasks 由 SSE 的 timeline_snapshot 事件驱动。
  const [timelineTasks, setTimelineTasks] = useState<TaskRecord[]>([]);
  // Ref for streaming message: updated DIRECTLY in SSE handler (no React batching).
  // This is the authoritative source for the in-flight AiMessageBubble.
  const streamingTasksRef = useRef<TaskRecord[]>([]);
  // State derived from ref — triggers re-render when ref changes so
  // AiMessageBubble always gets fresh tasks without state batching delays.
  const [streamingTasks, setStreamingTasks] = useState<TaskRecord[]>([]);

  // Load preferred model from localStorage (per-mode storage)
  useEffect(() => {
    const saved = localStorage.getItem("preferredModel");
    if (saved) setSelectedModel(saved);
  }, []);

  // 获取模式类别（chat/image/video）用于模型偏好存储
  const getModeCategory = (mode: AiMode): string => {
    if (mode === "image") return "image";
    if (mode === "video") return "video";
    return "chat";
  };

  // Switch model when mode changes (user preference > system default)
  useEffect(() => {
    const modeCategory = getModeCategory(aiMode);
    // 优先读取用户在该模式类别下的偏好
    const modeKey = `preferredModel_${modeCategory}`;
    const saved = localStorage.getItem(modeKey);
    if (saved) {
      setSelectedModel(saved);
      return;
    }
    // 没有保存过偏好，使用模式系统默认模型
    const defaults: Record<string, string> = {
      chat: "agnes:agnes-2.5-flash",
      image: "agnes:agnes-image-2.1-flash",
      video: "agnes:agnes-video-v2.0",
    };
    setSelectedModel(defaults[modeCategory] ?? "agnes:agnes-2.5-flash");
  }, [aiMode]);

  // 模式切换时清空参考图（Image 和 Video 模式都支持参考图）
  useEffect(() => {
    if (aiMode !== "image" && aiMode !== "video") {
      setInputFileIds([]);
    }
  }, [aiMode]);

  // Tracks whether the static preset-welcome typewriter is currently running
  // for the active conversation. Used to skip auto-scrolling to the typing
  // indicator while the typewriter is mid-animation.
  const welcomeTypewriterRef = useRef<{
    convId: string;
    timerId: ReturnType<typeof setInterval> | null;
  } | null>(null);

  // Refs to avoid stale-closure issues in async callbacks
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationVersionRef = useRef(0);
  const prevConversationIdRef = useRef<string | null | undefined>(undefined);
  const messagesRef = useRef<Message[]>([]);
  const aiModeRef = useRef<AiMode>("auto");
  const selectedModelRef = useRef<string>("agnes:agnes-2.5-flash");
  const conversationIdRef = useRef<string | null | undefined>(undefined);
  // 跳进程 message 轮询 ref（生图模式）
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks if we should skip the next assistant message (workflow match case)
  const skipAssistantMessageRef = useRef<string | null>(null);
  // Ref for chat sub-mode dropdown open state
  const chatToolModeRef = useRef<ChatToolMode>("chat");
  // Sync chatToolMode to ref
  useLayoutEffect(() => {
    chatToolModeRef.current = chatToolMode;
  }, [chatToolMode]);

  // Keep refs in sync with state — useLayoutEffect runs synchronously after
  // render, avoiding the "Cannot update ref during render" lint error.
  useLayoutEffect(() => {
    messagesRef.current = messages;
    aiModeRef.current = aiMode;
    selectedModelRef.current = selectedModel;
    conversationIdRef.current = conversationId;
  });

  // ─── Load conversation messages ─────────────────────────────────────────────

  const loadMessages = useCallback(
    async (convId: string, version: number) => {
      setIsMessagesLoading(true);
      try {
        const res = await fetch(`/api/ai/conversations/${convId}`);
        if (version !== conversationVersionRef.current) return;
        if (res.status === 404) {
          // 会话不存在（已删除 / 失效）—— 静默清空,通知父组件清掉无效 id
          setMessages([]);
          onConversationMissing?.(convId);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const conv = json.data;
        if (conv?.messages && Array.isArray(conv.messages)) {
          setMessages(
            conv.messages.map(
              (m: {
                id: string;
                role: string;
                content: string;
                sources?: unknown;
                metadata?: unknown;
                executionStatus?: string;
                attachments?: Array<{
                  id: string;
                  type: string;
                  fileAssetId: string;
                  direction?: string;
                }>;
              }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                sources: m.sources as SourceReference[] | undefined,
                thinkingSteps: (() => {
                  const steps = (m.metadata as { thinkingSteps?: TaskRecord[] } | undefined)
                    ?.thinkingSteps;
                  if (!Array.isArray(steps)) return undefined;
                  return steps.map((s) => ({
                    ...s,
                    startTime: typeof s.startTime === "number" && Number.isFinite(s.startTime) ? s.startTime : 0,
                    endTime: s.endTime !== undefined && s.endTime !== null && Number.isFinite(Number(s.endTime))
                      ? Number(s.endTime)
                      : undefined,
                  }));
                })(),
                totalThinkingMs: (m.metadata as { totalThinkingMs?: number } | undefined)
                  ?.totalThinkingMs,
                executionStatus: m.executionStatus,
                attachments: m.attachments,
                // 从 INPUT attachments 构建 userImages，用于刷新后气泡显示参考图
                userImages: m.attachments
                  ?.filter((a) => a.direction === "INPUT")
                  .map((a) => ({
                    id: a.fileAssetId,
                    url: `/api/ai/file-assets/${a.fileAssetId}`,
                    name: `参考图.${a.type === "IMAGE" ? "jpg" : "png"}`,
                  })),
                progress: (m.metadata as { progress?: Message["progress"] } | undefined)?.progress,
              })
            )
          );
        }
      } catch (err) {
        if (version === conversationVersionRef.current) {
          console.error("[AiChatPanel] load messages error:", err);
          setMessages([]);
        }
      } finally {
        if (version === conversationVersionRef.current) setIsMessagesLoading(false);
      }
    },
    []
  );


  // ─── Auto-greet on new conversation ─────────────────────────────────────────

  const pickGreetingHint = useCallback(() => {
    const hints = [
      "正在根据你的画像准备一句开场白…",
      "正在翻看我们最近的对话，找点共同话题…",
      "正在结合你的角色和项目，主动想个问候…",
    ];
    const idx = Math.floor(Math.random() * hints.length);
    return hints[idx];
  }, []);

  // Stream an AI greeting for a freshly created (empty) conversation. The
  // greeting is persisted as the first assistant message of the conversation
  // by the API. We do NOT inject a placeholder Message into the `messages`
  // array during streaming — instead we use the existing `streamingContent`
  // + `streamingTasks` + `isLoading` state, rendered as a single
  // AiMessageBubble that shows thinking steps in real time.
  const triggerGreeting = useCallback(
    async (convId: string, version: number) => {
      if (version !== conversationVersionRef.current) return;
      setIsLoading(true);
      setStreamingContent("");
      setPendingSources([]);

      // ── Greeting has no LangGraph timeline — fake a single thinking step
      // so the in-flight bubble shows the same thinking UI as a real query.
      const greetingExecId = `greeting-${Date.now()}`;
      const greetingStart = Date.now();
      const greetingTasks: TaskRecord[] = [
        {
          id: greetingExecId,
          parentId: null,
          stepLabel: "主动准备问候",
          title: "正在根据你的画像主动准备问候",
          status: "running",
          category: "system",
          detail: "结合最近讨论过的话题为你生成问候语",
          startTime: greetingStart,
        },
      ];
      streamingTasksRef.current = greetingTasks;
      setStreamingTasks(greetingTasks);
      setTimelineTasks(greetingTasks);

      const controller = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(
          `/api/ai/conversations/${convId}/greeting`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
          }
        );

        if (!response.ok) return;

        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (version !== conversationVersionRef.current) return;
              if (parsed.type === "text") {
                fullContent += parsed.delta;
                setStreamingContent(fullContent);
              } else if (parsed.type === "done") {
                // Complete the greeting thinking step
                const completedTasks: TaskRecord[] = greetingTasks.map((t) =>
                  t.id === greetingExecId
                    ? {
                        ...t,
                        status: "success",
                        endTime: Date.now(),
                        detail: `已生成（${Date.now() - greetingStart}ms）`,
                      }
                    : t,
                );
                streamingTasksRef.current = completedTasks;
                setStreamingTasks(completedTasks);
                setTimelineTasks(completedTasks);

                // Commit the streamed greeting into the messages list as
                // the assistant message of the conversation.
                const greetingId = `assistant-greeting-${convId}`;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: greetingId,
                    role: "assistant",
                    content: fullContent,
                    thinkingSteps: completedTasks,
                  },
                ]);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      } catch {
        // Silently ignore — the conversation still exists, user can retry
        // by sending a message.
      } finally {
        if (version === conversationVersionRef.current) {
          setIsLoading(false);
          setStreamingContent("");
        }
      }
    },
    []
  );

  // ─── Welcome typewriter ────────────────────────────────────────────────────

  // The preset welcome message is rendered as a typewriter (so the first
  // bubble feels alive too, not a wall of static text). We reveal the
  // string one character at a time via setInterval, then — once the
  // reveal is complete — kick off the AI greeting. If the conversation
  // changes mid-typewriter, the cleanup function cancels the timer so the
  // animation never bleeds across conversations.
  //
  // Speed tuning: 45ms/char ≈ 22 chars/sec, close to comfortable silent
  // reading speed in Chinese. Total reveal for the default welcome
  // (~70 chars) finishes in ~3 seconds.
  const WELCOME_TYPEWRITER_INTERVAL_MS = 45;
  const WELCOME_TYPEWRITER_CHARS_PER_TICK = 1;

  const WELCOME_CONTENT =
    "你好！我是小星，恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。我可以帮你查找工单、查看提交记录、回顾笔记。有什么可以帮你的吗？";

  const playWelcomeTypewriter = useCallback(
    (convId: string, version: number) => {
      // Tear down any in-flight typewriter (e.g. user re-clicks 新对话).
      if (welcomeTypewriterRef.current?.timerId) {
        clearInterval(welcomeTypewriterRef.current.timerId);
      }

      const welcomeId = `welcome-${convId}`;
      // Seed the bubble with the first character so the user sees something
      // immediately (avoids a flash of empty bubble).
      setMessages((prev) => {
        if (prev.some((m) => m.id === welcomeId)) return prev;
        return [
          ...prev,
          {
            id: welcomeId,
            role: "assistant",
            content: WELCOME_CONTENT.slice(0, 1),
          },
        ];
      });

      let revealed = 1;
      const total = WELCOME_CONTENT.length;
      const timerId = setInterval(() => {
        if (version !== conversationVersionRef.current) {
          clearInterval(timerId);
          return;
        }
        revealed = Math.min(revealed + WELCOME_TYPEWRITER_CHARS_PER_TICK, total);
        const snapshot = WELCOME_CONTENT.slice(0, revealed);
        setMessages((prev) =>
          prev.map((m) => (m.id === welcomeId ? { ...m, content: snapshot } : m))
        );
        if (revealed >= total) {
          if (welcomeTypewriterRef.current?.timerId) {
            clearInterval(welcomeTypewriterRef.current.timerId);
          }
          welcomeTypewriterRef.current = null;
          // Welcome is fully revealed. Now stream the personalized greeting
          // so the second bubble shows up.
          void triggerGreeting(convId, version);
        }
      }, WELCOME_TYPEWRITER_INTERVAL_MS);

      welcomeTypewriterRef.current = { convId, timerId };
    },
    [triggerGreeting]
  );

  // Cleanup: cancel any active typewriter and polling when this component unmounts or
  // when the user switches to a different conversation.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (welcomeTypewriterRef.current?.timerId) {
        clearInterval(welcomeTypewriterRef.current.timerId);
      }
      welcomeTypewriterRef.current = null;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ─── Respond to conversationId changes ──────────────────────────────────────

  useEffect(() => {
    if (conversationId === prevConversationIdRef.current) return;
    prevConversationIdRef.current = conversationId;
    const version = ++conversationVersionRef.current;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (welcomeTypewriterRef.current?.timerId) {
      clearInterval(welcomeTypewriterRef.current.timerId);
    }
    welcomeTypewriterRef.current = null;

    setIsLoading(false);
    setIsMessagesLoading(Boolean(conversationId));
    setMessages(
      conversationId
        ? []
        : isPage
          ? []
          : [
              {
                id: "welcome",
                role: "assistant",
                content:
                  "你好！我是小星，恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。我可以帮你查找工单、查看提交记录、回顾笔记。有什么可以帮你的吗？",
              },
            ],
    );
    setStreamingContent("");
    setPendingSources([]);
    setActiveToolCall(null);
    setToolCallChain([]);
    setTimelineTasks([]);

    void (async () => {
      if (conversationId) {
        await loadMessages(conversationId, version);
        if (version !== conversationVersionRef.current) return;
        if (autoGreet && version === conversationVersionRef.current) {
          onGreetingConsumed?.(conversationId);
        }
      } else {
        setMessages([]);
        setStreamingContent("");
        setPendingSources([]);
        setToolCallChain([]);
      }
    })();
  }, [
    conversationId,
    isPage,
    loadMessages,
    autoGreet,
    playWelcomeTypewriter,
    onGreetingConsumed,
  ]);

  // ─── Scroll ────────────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // ─── Image generation polling (cross-process: worker → DB → poll) ─────────────

  const startPolling = useCallback(
    (
      messageId: string,
      startTime: number,
      timeoutMs = 3 * 60 * 1000,
      contentTexts?: { success: string; failure: string }
    ) => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(async () => {
        // 超时保护：默认 3 分钟（图片），可配置（视频 5 分钟）
        if (Date.now() - startTime > timeoutMs) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          return;
        }
        try {
          const res = await fetch(`/api/ai/messages/${messageId}`);
          if (!res.ok) return;
          const data = (await res.json()) as {
            id: string;
            executionStatus: string;
            metadata?: {
              progress?: { step: string; percent?: number; detail?: string };
            };
            attachments: Array<{ id: string; type: string; fileAssetId: string }>;
          };
          const progress = data.metadata?.progress;
          if (
            data.executionStatus === "COMPLETED" ||
            data.executionStatus === "FAILED"
          ) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            // 更新 messages state，把占位替换为包含 attachments 的真实 message
            const successText = contentTexts?.success ?? "图片已生成";
            const failureText = contentTexts?.failure ?? "图片生成失败";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      content:
                        data.executionStatus === "COMPLETED" ? successText : failureText,
                      executionStatus: data.executionStatus,
                      attachments: data.attachments,
                      progress: undefined, // 完成后清除进度
                    }
                  : m,
              ),
            );
          } else {
            // 更新进度
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      content: progress?.detail ?? m.content,
                      executionStatus: data.executionStatus,
                      progress: progress ?? m.progress,
                    }
                  : m,
              ),
            );
          }
        } catch {
          // 忘记错误，下次轮询继续尝试
        }
      }, 2000);
    },
    []
  );

  // ─── Send message ───────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (
      message: string,
      images?: { id: string; url: string; name: string }[],
      inputFileIds?: { id: string; url: string; name: string }[]
    ) => {
      // Chat 模式识图：图片通过 onChatImagesChange → chatImages state → 传给后端。
      // Image/Video 模式的 inputFileIds 路径不变。
      const chatInputFileIds =
        aiModeRef.current === "chat"
          ? ((images && images.length > 0)
              ? images
              : chatImages.length > 0
                ? chatImages
                : undefined)
          : undefined;
      // #region agent log
      fetch('http://127.0.0.1:7670/ingest/9605da00-d652-4ae2-960d-898d8224e6df',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ebf0e5'},body:JSON.stringify({sessionId:'ebf0e5',location:'AiChatPanel.tsx:801',message:'[H-B] chatInputFileIds',data:{mode:aiModeRef.current,imagesParam:images?.length||0,chatImagesState:chatImages.length,chatInputFileIds:chatInputFileIds?.map(x=>x.id)},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      // 不在此处清空 chatImages：handleSubmit 中 AiChatInput 会通过
      // onChatImagesChange?.([]) 同步清空（单一 source of truth 原则）。
      // ── Image generation mode (提前 return，不走 SSE 流) ────────────────────
      if (aiModeRef.current === "image") {
        // Optimistically add user message with reference images
        const tempUserId = `user-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: tempUserId,
            role: "user",
            content: message,
            userImages: inputFileIds?.map((img) => ({
              id: img.id,
              url: img.url,
              name: img.name,
            })),
          },
        ]);

        try {
          // 生图模式下新对话没有 conversationId：先建对话再入队，
          // 与普通对话首条消息隐式建会话保持一致的用户体验。
          let convId = conversationIdRef.current;
          if (!convId) {
            const createRes = await fetch("/api/ai/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: message }),
            });
            if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`);
            const created = (await createRes.json()) as {
              data: { id: string } | null;
              error: string | null;
            };
            if (!created.data) throw new Error(created.error ?? "创建对话失败");
            convId = created.data.id;
            conversationIdRef.current = convId;
            onConversationCreated?.(convId);
          }

          const res = await fetch("/api/ai/generate/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: convId,
              prompt: message,
              modelName: selectedModelRef.current,
              inputFileIds: inputFileIds?.map((img) => img.id) ?? [],
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            messageId: string;
            executionStatus: string;
          };
          // 展示占位 message
          setMessages((prev) => [
            ...prev,
            {
              id: data.messageId,
              role: "assistant" as const,
              content: "正在生成图片...",
              executionStatus: "QUEUED",
              attachments: [],
              loadingType: "image",
            },
          ]);
          // 开始轮询
          startPolling(data.messageId, Date.now());
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant" as const,
              content: "生图失败，请稍后重试。",
            },
          ]);
        }
        return;
      }
      // ── End image mode ─────────────────────────────────────────────────────

      // ── Video generation mode (提前 return，不走 SSE 流) ───────────────────
      if (aiModeRef.current === "video") {
        // Optimistically add user message with reference images
        const tempUserId = `user-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: tempUserId,
            role: "user",
            content: message,
            userImages: inputFileIds?.map((img) => ({
              id: img.id,
              url: img.url,
              name: img.name,
            })),
          },
        ]);

        try {
          // 生视频模式下新对话没有 conversationId：先建对话再入队，
          // 与普通对话首条消息隐式建会话保持一致的用户体验。
          let convId = conversationIdRef.current;
          if (!convId) {
            const createRes = await fetch("/api/ai/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: message }),
            });
            if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`);
            const created = (await createRes.json()) as {
              data: { id: string } | null;
              error: string | null;
            };
            if (!created.data) throw new Error(created.error ?? "创建对话失败");
            convId = created.data.id;
            conversationIdRef.current = convId;
            onConversationCreated?.(convId);
          }

          const res = await fetch("/api/ai/generate/video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: convId,
              prompt: message,
              modelName: selectedModelRef.current,
              inputFileIds: inputFileIds?.map((img) => img.id) ?? [],
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            messageId: string;
            executionStatus: string;
          };
          // 展示占位 message
          setMessages((prev) => [
            ...prev,
            {
              id: data.messageId,
              role: "assistant" as const,
              content: "正在生成视频...",
              executionStatus: "QUEUED",
              attachments: [],
              loadingType: "video",
            },
          ]);
          // 开始轮询（视频生成较慢，超时设为 5 分钟）
          startPolling(
            data.messageId,
            Date.now(),
            5 * 60 * 1000,
            { success: "视频已生成", failure: "视频生成失败" }
          );
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant" as const,
              content: "视频生成失败，请稍后重试。",
            },
          ]);
        }
        return;
      }
      // ── End video mode ────────────────────────────────────────────────────

      const conversationVersion = conversationVersionRef.current;
      const requestController = new AbortController();
      const tempUserId = `user-${Date.now()}`;

      // Optimistically add user message immediately so it shows up while the
      // AI stream is in flight, regardless of whether this is a new or
      // existing conversation. The server will later persist it on its own.
      // W5 fix: Chat 模式下也带上 userImages（与 Image/Video 模式一致），
      // 否则用户上传图片后，发送后图片从输入框消失，气泡只显示文字（要刷新页面
      // 才从 attachments 重建）。Chat 模式优先用 onSend 的入参 images（最新值），
      // fallback 到 chatImages state（避免 React stale closure）。
      const optimisticUserImages = (images && images.length > 0)
        ? images
        : chatImages.length > 0
          ? chatImages
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: message,
          ...(optimisticUserImages && optimisticUserImages.length > 0
            ? { userImages: optimisticUserImages }
            : {}),
        },
      ]);

      setIsLoading(true);
      setStreamingContent("");
      setPendingSources([]);
      setToolCallChain([]);

      // Pre-render every step of the upcoming pipeline as `running` so the
      // user sees the FULL plan (including the long-running "生成回答" step)
      // with a visible loading spinner BEFORE the backend snapshot arrives.
      // The placeholder stepLabels act as merge keys when the real
      // timeline_snapshot overwrites them.
      const placeholders = buildPlaceholderTasks(aiModeRef.current);
      streamingTasksRef.current = placeholders;
      setStreamingTasks(placeholders);
      setTimelineTasks(placeholders);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = requestController;

      try {
        const conversationHistory = messagesRef.current.slice(-10).map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
        }));

        const mode = aiModeRef.current;
        const useSearch = mode === "search";
        const useWebSearch = mode === "web" || (mode === "auto" && shouldUseWebSearch(message));
        const modelName = selectedModelRef.current;

        // 确保会话 ID 存在（新对话先创建对应 category: "CHAT" 的会话）
        let convId = conversationIdRef.current || conversationId;
        if (!convId) {
          const createRes = await fetch("/api/ai/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: message.slice(0, 30) || "新对话",
              category: "CHAT",
            }),
          });
          if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`);
          const created = (await createRes.json()) as {
            data: { id: string } | null;
            error: string | null;
          };
          if (!created.data?.id) throw new Error(created.error ?? "创建对话失败");
          convId = created.data.id;
          conversationIdRef.current = convId;
          onConversationCreated?.(convId);
        }

        // Determine endpoint and body
        const url = `/api/ai/conversations/${convId}/messages`;
        const body: Record<string, unknown> = {
          message,
          conversationHistory,
          mode,
          forceSearch: useSearch,
          useWebSearch,
          modelName,
          // Chat 模式图片挂 AiMessageAttachment(INPUT)；Image/Video 模式不重复
          ...(chatInputFileIds && chatInputFileIds.length > 0
            ? { inputImageIds: chatInputFileIds.map((img) => img.id) }
            : {}),
        };
        // 获取客户端城市名（用于天气等实时数据搜索）
        // 无论 intent 分类结果如何，auto/web 模式都尝试获取 VPN 出口 IP 对应的城市
        if (mode === "auto" || mode === "web") {
          const city = await getClientCity();
          if (conversationVersion !== conversationVersionRef.current) return;
          if (city) body.clientCity = city;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: requestController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Handle SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";
        let sources: SourceReference[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data);
              // Guard: skip events from a stale conversation version.
              // Use ref↔ref comparison (stable identity), not state↔ref (state may lag).
              const currentVersion = conversationVersionRef.current;
              if (parsed.conversationId && convId && parsed.conversationId !== convId) {
                return;
              }

              if (parsed.type === "conversation") {
                // First message in a new conversation: API created the conversation
                if (parsed.id) {
                  onConversationCreated?.(parsed.id);
                }
              } else if (parsed.type === "text") {
                fullContent += parsed.delta;
                setStreamingContent(fullContent);
                // 收到文本说明已进入回答生成阶段，激活最后一个步骤为 running
                if (streamingTasksRef.current.length > 0) {
                  const currentTasks = streamingTasksRef.current;
                  const lastIdx = currentTasks.length - 1;
                  if (lastIdx >= 0 && currentTasks[lastIdx].status === "pending") {
                    const prevTask = lastIdx > 0 ? currentTasks[lastIdx - 1] : undefined;
                    const startTime = prevTask?.endTime ?? Date.now();
                    const updated = currentTasks.map((t, idx) =>
                      idx === lastIdx
                        ? { ...t, status: "running" as const, startTime: (t.startTime && t.startTime > 0 ? t.startTime : startTime) }
                        : (t.status === "running" ? { ...t, status: "success" as const, endTime: startTime } : t)
                    );
                    streamingTasksRef.current = updated;
                    setStreamingTasks(updated);
                    setTimelineTasks(updated);
                  }
                }
              } else if (parsed.type === "sources") {
                sources = parsed.sources ?? [];
                setPendingSources(sources);
              } else if (parsed.type === "timeline_snapshot") {
                // Timeline events from the new TimelineStore integration.
                // These are flat TaskRecord[] from the backend's TimelineAdapter.
                if (Array.isArray(parsed.tasks)) {
                  const incoming = parsed.tasks as TaskRecord[];
                  const incomingByNodeOrLabel = new Map<string, TaskRecord>();
                  for (const t of incoming) {
                    if (t.nodeName) incomingByNodeOrLabel.set(t.nodeName, t);
                    if (t.stepLabel) incomingByNodeOrLabel.set(t.stepLabel, t);
                  }

                  const currentPlaceholders = streamingTasksRef.current;
                  const merged: TaskRecord[] = [];
                  const matchedTaskIds = new Set<string>();

                  for (const ph of currentPlaceholders) {
                    const nodeName = ph.nodeName ?? (ph.id.startsWith("placeholder-") ? ph.id.replace("placeholder-", "") : undefined);
                    const real = (nodeName && incomingByNodeOrLabel.get(nodeName)) || incomingByNodeOrLabel.get(ph.stepLabel);
                    if (real) {
                      merged.push(real);
                      matchedTaskIds.add(real.id);
                    } else {
                      merged.push(ph);
                    }
                  }

                  // 追加未被 placeholder 覆盖的后端任务（例如动态的 humanConfirmation 节点）
                  for (const t of incoming) {
                    if (!matchedTaskIds.has(t.id)) {
                      merged.push(t);
                    }
                  }

                  // 推进状态：让第一个未完成的任务进入 running 并记录准确 startTime，后续任务保持 pending
                  let foundFirstUnfinished = false;
                  const updatedMerged = merged.map((t, idx, arr) => {
                    if (t.status === "success" || t.status === "error" || t.status === "warning") {
                      return t;
                    }
                    if (!foundFirstUnfinished) {
                      foundFirstUnfinished = true;
                      const prevTask = idx > 0 ? arr[idx - 1] : undefined;
                      const startTime = (typeof t.startTime === "number" && t.startTime > 0)
                        ? t.startTime
                        : (prevTask?.endTime ?? Date.now());
                      return {
                        ...t,
                        status: "running" as const,
                        startTime,
                      };
                    }
                    return {
                      ...t,
                      status: "pending" as const,
                      startTime: 0,
                      endTime: undefined,
                    };
                  });

                  streamingTasksRef.current = updatedMerged;
                  setStreamingTasks(updatedMerged);
                  setTimelineTasks(updatedMerged);
                }
              } else if (parsed.type === "done") {
                setActiveToolCall(null);
                setToolCallChain([]);
                const now = Date.now();
                const currentTasks = streamingTasksRef.current;
                const hasRealTasks = currentTasks.some((t) => !t.id.startsWith("placeholder-"));
                const finalTasks = currentTasks.length > 0
                  ? currentTasks
                      .filter((t) => {
                        // 移除未被实际执行的分支 placeholder（pending 状态），避免多余的 0ms 幽灵步骤
                        if (hasRealTasks && t.id.startsWith("placeholder-") && t.status === "pending") {
                          return false;
                        }
                        return true;
                      })
                      .map((t, idx, arr) => {
                        if (t.status === "running" || t.id.startsWith("placeholder-")) {
                          const prevTask = idx > 0 ? arr[idx - 1] : undefined;
                          const startTime = (typeof t.startTime === "number" && t.startTime > 0)
                            ? t.startTime
                            : (prevTask?.endTime ?? now);
                          return {
                            ...t,
                            status: (t.status === "error" ? "error" : "success") as TaskRecord["status"],
                            startTime,
                            endTime: (typeof t.endTime === "number" && t.endTime > 0) ? t.endTime : now,
                          };
                        }
                        return t;
                      })
                  : undefined;
                streamingTasksRef.current = finalTasks ?? [];
                setStreamingTasks(finalTasks ?? []);
                // Calculate total thinking time for the assistant message
                const totalThinkingMs =
                  finalTasks && finalTasks.length > 0
                    ? (() => {
                        const starts = finalTasks
                          .map((t) => t.startTime)
                          .filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
                        const ends = finalTasks
                          .map((t) => t.endTime)
                          .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
                        if (starts.length === 0 || ends.length === 0) return undefined;
                        return Math.max(0, Math.max(...ends) - Math.min(...starts));
                      })()
                    : undefined;
                const assistantMessage: Message = {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  content: fullContent,
                  sources: sources.length > 0 ? sources : undefined,
                  thinkingSteps: finalTasks,
                  totalThinkingMs,
                };
                // If we detected a workflow match, skip adding this message
                // (the workflow card is already shown instead)
                const shouldSkip = skipAssistantMessageRef.current === assistantMessage.id;
                if (shouldSkip) {
                  skipAssistantMessageRef.current = null;
                } else {
                  setMessages((prev) => [...prev, assistantMessage]);
                }
                setIsLoading(false);
                setStreamingContent("");
                setPendingSources([]);

                // thinkingSteps now lives inside the bubble — no external collapse timer needed
              } else if (parsed.type === "workflow_match") {
                // Workflow match detected by backend — show inline card for optimistic switch
                setWorkflowMatch({
                  workflowType: parsed.workflowType,
                  workflowName: parsed.workflowName,
                  description: parsed.description || "即将启动工作流",
                  goalPrompt: parsed.goalPrompt || "",
                });
                // Store the message ID to skip in done handler
                skipAssistantMessageRef.current = `assistant-${Date.now()}`;
              } else if (parsed.type === "tool_call") {
                const toolLabel =
                  parsed.toolName === "webSearch"
                    ? "联网搜索"
                    : parsed.toolName === "searchKnowledge"
                      ? "知识检索"
                      : parsed.toolName === "searchStructured"
                        ? "数据库查询"
                        : parsed.toolName;
                setToolCallChain((prev) => {
                  // Replace any in-flight entry for the same tool so re-entrant
                  // calls don't duplicate rows.
                  const next = prev.filter((c) => c.toolName !== parsed.toolName || c.status !== "calling");
                  return [
                    ...next,
                    {
                      toolName: parsed.toolName,
                      displayLabel: toolLabel,
                      status: "calling",
                    },
                  ];
                });
                setActiveToolCall({
                  toolName: parsed.toolName,
                  displayLabel: toolLabel,
                  status: "calling",
                });
              } else if (parsed.type === "tool_result") {
                const formatted = formatToolResult(parsed.output);
                setToolCallChain((prev) => {
                  const idx = prev.findIndex(
                    (c) => c.toolName === parsed.toolName && c.status === "calling"
                  );
                  if (idx === -1) {
                    // Result arrived before call (rare); append as done row.
                    return [
                      ...prev,
                      {
                        toolName: parsed.toolName,
                        displayLabel: parsed.toolName,
                        status: "done",
                        message: formatted,
                      },
                    ];
                  }
                  const next = prev.slice();
                  next[idx] = { ...next[idx], status: "done", message: formatted };
                  return next;
                });
                setActiveToolCall((prev) =>
                  prev && prev.toolName === parsed.toolName
                    ? { ...prev, status: "done", message: formatted }
                    : prev
                );
              } else if (parsed.type === "tool_error") {
                const errorMsg = parsed.error;
                setToolCallChain((prev) => {
                  const idx = prev.findIndex(
                    (c) => c.toolName === parsed.toolName && c.status === "calling"
                  );
                  if (idx === -1) {
                    return [
                      ...prev,
                      {
                        toolName: parsed.toolName,
                        displayLabel: parsed.toolName,
                        status: "error",
                        message: errorMsg,
                      },
                    ];
                  }
                  const next = prev.slice();
                  next[idx] = { ...next[idx], status: "error", message: errorMsg };
                  return next;
                });
                setActiveToolCall((prev) =>
                  prev && prev.toolName === parsed.toolName
                    ? { ...prev, status: "error", message: errorMsg }
                    : prev
                );
              } else if (parsed.type === "pending_confirmation") {
                // Human-in-Loop: render candidate picker above input (not as a message bubble)
                setPendingCandidates(parsed.candidates ?? []);
                // Still add a brief natural-language hint message so the conversation context is clear.
                // Dynamic label based on entityType to avoid "用户" for weekly_report etc.
                const entityType = (parsed as { entityType?: string }).entityType ?? "user";
                const entityLabelMap: Record<string, string> = { user: "用户", weekly_report: "周报", ticket: "工单", project: "项目" };
                const entityLabel = entityLabelMap[entityType] ?? "匹配项";
                setIsLoading(false);
                setStreamingContent("");
                const hintMsg: Message = {
                  id: `pending-confirm-${Date.now()}`,
                  role: "assistant",
                  content: `找到 ${parsed.candidates?.length} 个${entityLabel}匹配，请在下方选择目标${entityLabel}：`,
                };
                setMessages((prev) => [...prev, hintMsg]);
              } else if (parsed.type === "error") {
                setActiveToolCall(null);
                throw new Error(parsed.message || "Stream error");
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "AbortError" || conversationVersion !== conversationVersionRef.current)
        ) {
          return;
        }
        console.error("Chat error:", error);
        // Mark all remaining placeholder tasks as error so no spinner gets stuck
        const errorTasks = streamingTasksRef.current.map((t) =>
          t.id.startsWith("placeholder-")
            ? { ...t, status: "error" as const, endTime: Date.now() }
            : t
        );
        streamingTasksRef.current = errorTasks;
        setStreamingTasks(errorTasks);
        setTimelineTasks(errorTasks);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: "抱歉，生成回答时遇到了问题。请稍后重试。",
            thinkingSteps: errorTasks.length > 0 ? errorTasks : undefined,
          },
        ]);
        setIsLoading(false);
        setStreamingContent("");
        setActiveToolCall(null);
        setToolCallChain([]);
      }
    },
    [conversationId, onConversationCreated, startPolling, chatImages]
  );
  const initialMessageSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      initialMessage &&
      initialMessageSentRef.current !== initialMessage &&
      !isLoading
    ) {
      initialMessageSentRef.current = initialMessage;
      void handleSend(initialMessage, initialImages);
    }
  }, [initialMessage, initialImages, isLoading, handleSend]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStreamingContent((current) => {
        if (current) {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: current,
              sources: pendingSources.length > 0 ? pendingSources : undefined,
            },
          ]);
        }
        return "";
      });
      setIsLoading(false);
      setPendingSources([]);
      setActiveToolCall(null);
      setToolCallChain([]);
    }
  }, [pendingSources]);

  // ── Workflow Match Handlers ─────────────────────────────────────────────────

  const handleStartWorkflow = useCallback((workflowType: string, goalPrompt?: string) => {
    setWorkflowMatch(null);
    setIsLoading(false);
    onStartWorkflow?.(workflowType, goalPrompt);
  }, [onStartWorkflow]);

  const handleWorkflowDismiss = useCallback(() => {
    setWorkflowMatch(null);
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
  }, [isPage]);

  const padding = isPage ? "p-6" : "p-3";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Floating 模式精简 Header (isPage 下彻底移除，由右侧会话辅助检查器承载) */}
      {!isPage && (
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5 pr-12 bg-white">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-xs">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="text-xs font-semibold text-ink-900">小星 · AI 助手</span>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="rounded p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
            title="清空对话"
            aria-label="清空对话"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto ${padding}`}>
        <div className="space-y-4">
          {/* Loading skeleton — Code Agent style */}
          {isMessagesLoading && (
            <>
              {/* AI message: left-aligned full-width panel */}
              <div className="w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
                <div className="border-b border-ink-200 bg-gradient-to-b from-brand-50/30 to-white p-3">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 animate-pulse rounded-full bg-brand-200" />
                    <div className="h-3 w-24 animate-pulse rounded bg-brand-100" />
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <div className="h-3 w-full animate-pulse rounded bg-ink-100" />
                  <div className="h-3 w-5/6 animate-pulse rounded bg-ink-100" />
                  <div className="h-3 w-4/6 animate-pulse rounded bg-ink-100" />
                </div>
              </div>
              {/* User message: right-aligned bubble */}
              <div className="flex justify-end">
                <div className="max-w-[75%]">
                  <div className="rounded-2xl bg-brand-600 px-4 py-2.5">
                    <div className="h-3 w-48 animate-pulse rounded bg-brand-400/50" />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Message list */}
          {!isMessagesLoading &&
            messages.map((msg) => (
              <div key={msg.id}>
                <AiMessageBubble
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  candidates={msg.candidates}
                  thinkingSteps={msg.thinkingSteps}
                  totalThinkingMs={msg.totalThinkingMs}
                  executionStatus={msg.executionStatus}
                  attachments={msg.attachments}
                  userImages={msg.userImages}
                  loadingType={msg.loadingType ?? (aiModeRef.current === "video" ? "video" : "image")}
                  progress={msg.progress}
                  onCandidateSelect={(candidateId) => handleSend(candidateId)}
                />
              </div>
            ))}

          {/* Streaming message — show as soon as thinking tasks arrive (no waiting for text) */}
          {isLoading && (
            <div>
              <AiMessageBubble
                role="assistant"
                content={streamingContent}
                sources={pendingSources.length > 0 ? pendingSources : undefined}
                isStreaming
                thinkingSteps={streamingTasks}
                loadingType={aiModeRef.current === "video" ? "video" : "image"}
              />
            </div>
          )}

          {/* Empty state for page variant with no messages */}
          {!isMessagesLoading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center max-w-2xl mx-auto">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 shadow-md">
                <IconSparkles className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-base font-semibold text-ink-900">你好！我是小星 AI 助手</h3>
              <p className="mt-1 max-w-sm text-xs text-ink-500">
                可进行日常自由探索问答，或选择工作流向导提炼任务并转入 Work 工作台执行。
              </p>

              {/* Quick Choice Section */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                {/* Chat Mode Card */}
                <div className="rounded-2xl border border-ink-200 bg-white p-4 shadow-2xs hover:border-brand-200 transition">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">💬</span>
                    <span className="text-xs font-semibold text-ink-800">日常自由问答</span>
                  </div>
                  <p className="text-[11px] text-ink-500 mb-3">
                    随时检索知识库、询问工单信息或交流代码设计思路。
                  </p>
                  <div className="space-y-1.5">
                    {[
                      "帮我总结一下最近有哪些活跃工单？",
                      "系统中如何将 Git 提交关联到工单？",
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleSend(prompt)}
                        className="w-full text-left text-[11px] text-ink-600 bg-ink-50 hover:bg-brand-50 hover:text-brand-700 rounded-lg px-2.5 py-1.5 transition line-clamp-1"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Work Workflow Guide Card */}
                <div className="rounded-2xl border border-brand-200 bg-brand-50/30 p-4 shadow-2xs hover:border-brand-300 transition">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">⚡</span>
                      <span className="text-xs font-semibold text-brand-900">工作任务向导</span>
                    </div>
                    {onSwitchToWorkMode && (
                      <button
                        type="button"
                        onClick={() => onSwitchToWorkMode?.()}
                        className="text-[10px] text-brand-600 hover:text-brand-800 font-medium"
                      >
                        直接去工作台 →
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-brand-700/80 mb-3">
                    对话梳理需求，确立后无缝带入工作台执行流水线。
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: "📊 生成周报", prompt: "帮我生成本周的工作周报" },
                      { label: "🚀 项目进展", prompt: "汇总查看当前项目的最新进展大盘" },
                      { label: "🎙️ 会议纪要", prompt: "帮我整理近期的会议纪要" },
                      { label: "💻 Coding开发", prompt: "帮我针对工单需求开发功能并测试" },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => handleSend(item.prompt)}
                        className="text-left text-[11px] font-medium text-brand-800 bg-white border border-brand-200 hover:bg-brand-100/50 rounded-lg p-2 transition shadow-2xs"
                      >
                        <div>{item.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Human-in-Loop: candidate picker */}
      {pendingCandidates && pendingCandidates.length > 0 && (
        <AiCandidatePicker
          isPage={isPage}
          options={pendingCandidates}
          onSelect={(option) => {
            // Send the candidate's label (user name) instead of the numeric index.
            // The graph receives this as the new message and uses parseSelection()
            // to match it against the pending candidates. This is more natural
            // than sending "1" which would parse as type=user in a fresh round.
            handleSend((option as CandidateUser).label ?? (option as CandidateUser).name ?? "");
            setPendingCandidates(null);
          }}
          onCancel={() => {
            handleSend("0");
            setPendingCandidates(null);
          }}
          onCustomInput={(text) => {
            // 直接发送用户输入的内容，让后端重新解析意图
            handleSend(text);
            setPendingCandidates(null);
          }}
          customInputPlaceholder="输入用户名或重新描述问题…"
        />
      )}

      {/* Workflow Match / Switch to Work Modal */}
      <SwitchToWorkModal
        isOpen={!!workflowMatch}
        initialGoalPrompt={workflowMatch?.goalPrompt || ""}
        suggestedWorkflowType={workflowMatch?.workflowType ?? ""}
        workflowName={workflowMatch?.workflowName ?? ""}
        description={workflowMatch?.description ?? ""}
        onConfirm={(goal, route) => {
          handleStartWorkflow(route ?? workflowMatch?.workflowType ?? "weekly_report", goal);
        }}
        onDismiss={handleWorkflowDismiss}
      />

      {/* Input */}
      <div className={`border-t border-ink-200 ${isPage ? "p-6" : "p-3"}`}>
        <AiChatInput
          onSend={handleSend}
          onStop={handleStop}
          isGenerating={isLoading}
          placeholder={isPage ? "输入问题，向小星提问…" : "输入问题..."}
          taskCategory={aiMode === "image" || aiMode === "video" ? aiMode : "chat"}
          initialReferenceImages={aiMode === "image" || aiMode === "video" ? inputFileIds : undefined}
          onReferenceImagesChange={aiMode === "image" || aiMode === "video" ? setInputFileIds : undefined}
          onChatImagesChange={setChatImagesDebug}
          selectedModel={selectedModel}
          thinkingLevel={propThinkingLevel}
          onThinkingLevelChange={onThinkingLevelChange}
        />
      </div>
    </div>
  );
}
