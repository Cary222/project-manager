"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AiChatInput } from "./AiChatInput";
import { AiCandidatePicker } from "./AiCandidatePicker";
import { AiMessageBubble } from "./AiMessageBubble";
import { type SourceReference } from "./AiSourcesList";
import { UserProfilePanel, type AiUserProfile } from "./UserProfilePanel";
import { ModelSelector } from "@/features/ai/llm/model-selector";
import {
  AI_MODE_OPTIONS,
  CHAT_SUB_MODE_OPTIONS,
  type AiMode,
  type ChatToolMode,
  type TaskRecord,
  buildStepPlan,
} from "@/features/ai/types";
import { shouldUseRag, shouldUseWebSearch } from "@/features/ai/search/detector";
import { IconSparkles, IconX } from "@/shared/ui/icons";
import { WorkflowMatchCard } from "./work/WorkflowMatchCard";

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
    stepLabel: t.nodeLabel,
    title: t.nodeLabel,
    category: placeholderCategory(t.nodeName),
    status: "running",
    // Stagger startTime by 1ms per step so they render in correct order
    // even before backend snapshots arrive. This prevents visual jank.
    startTime: now + idx,
  }));
}

interface AiChatPanelProps {
  variant?: "page" | "floating";
  conversationId?: string | null;
  onConversationCreated?: (id: string) => void;
  autoGreet?: boolean;
  onGreetingConsumed?: (id: string) => void;
  /** Switch to work mode (no workflow POST). Used by header button. */
  onSwitchToWorkMode?: () => void;
  /** Switch to work mode AND fire POST /api/ai/workflows in background. Used by WorkflowMatchCard. */
  onStartWorkflow?: (workflowType: string) => void;
  /** Notifies parent that the conversation no longer exists (e.g. 404). */
  onConversationMissing?: (id: string) => void;
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
}: AiChatPanelProps) {
  const isPage = variant === "page";

  const [messages, setMessages] = useState<Message[]>(() =>
    isPage
      ? []
      : [
          {
            id: "welcome",
            role: "assistant",
            content:
              "你好！我是小星，恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。我可以帮你查找工单、查看提交记录、回顾笔记。有什么可以帮你的吗？",
          },
        ]
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingSources, setPendingSources] = useState<SourceReference[]>([]);
  const [aiMode, setAiMode] = useState<AiMode>("auto");
  const [chatToolMode, setChatToolMode] = useState<ChatToolMode>("chat");
  const [userProfile, setUserProfile] = useState<AiUserProfile | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<{
    toolName: string;
    displayLabel: string;
    status: "calling" | "done" | "error";
    message?: string;
  } | null>(null);
  // Pending confirmation candidates — rendered as a detached picker above the input
  // (not as a message bubble in the conversation).
  const [pendingCandidates, setPendingCandidates] = useState<CandidateUser[] | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("agnes:agnes-2.5-flash");

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
  // Dropdown open state
  const [chatToolModeOpen, setChatToolModeOpen] = useState(false);
  const chatToolModeDropdownRef = useRef<HTMLDivElement>(null);

  // Sync chatToolMode to ref
  useLayoutEffect(() => {
    chatToolModeRef.current = chatToolMode;
  }, [chatToolMode]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!chatToolModeOpen) return;
    function handler(e: MouseEvent) {
      if (chatToolModeDropdownRef.current && !chatToolModeDropdownRef.current.contains(e.target as Node)) {
        setChatToolModeOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [chatToolModeOpen]);

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
                    startTime: typeof s.startTime === 'number' ? s.startTime : Number(s.startTime) || Date.now(),
                    endTime: s.endTime !== undefined && s.endTime !== null
                      ? (typeof s.endTime === 'number' ? s.endTime : Number(s.endTime))
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

  // ─── Load user profile ──────────────────────────────────────────────────────

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/profile");
      if (!res.ok) return;
      const json = await res.json();
      // API returns { data: { profile }, error } — unwrap one level.
      const profile = json?.data?.profile ?? null;
      setUserProfile(profile as AiUserProfile | null);
    } catch {
      // silently ignore
    }
  }, []);

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
        if (isPage) await loadProfile();
        // If the parent flagged this conversation as needing an AI greeting
        // (i.e. it was just created via the "新对话" button), play the
        // preset-welcome typewriter, which itself fires triggerGreeting once
        // the welcome text has been fully revealed.
        if (autoGreet && version === conversationVersionRef.current) {
          playWelcomeTypewriter(conversationId, version);
          onGreetingConsumed?.(conversationId);
        }
      } else {
        setMessages(
          isPage
            ? []
            : [
                {
                  id: "welcome",
                  role: "assistant",
                  content:
                    "你好！我是小星，恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。我可以帮你查找工单、查看提交记录、回顾笔记。有什么可以帮你的吗？",
                },
              ]
        );
        setStreamingContent("");
        setPendingSources([]);
        setToolCallChain([]);
      }
    })();
  }, [
    conversationId,
    isPage,
    loadMessages,
    loadProfile,
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
        const useSearch = mode === "search" || (mode === "auto" && shouldUseRag(message));
        const useWebSearch = mode === "auto" && shouldUseWebSearch(message);
        const modelName = selectedModelRef.current;

        // Determine endpoint and body
        let url: string;
        let body: Record<string, unknown>;

        if (conversationId) {
          url = `/api/ai/conversations/${conversationId}/messages`;
          body = {
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
        } else {
          url = "/api/ai/conversations";
          body = {
            firstMessage: message,
            conversationHistory,
            mode,
            forceSearch: useSearch,
            useWebSearch,
            modelName,
            ...(chatInputFileIds && chatInputFileIds.length > 0
              ? { inputImageIds: chatInputFileIds.map((img) => img.id) }
              : {}),
          };
        }

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
              if (parsed.conversationId && parsed.conversationId !== conversationId) {
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
              } else if (parsed.type === "sources") {
                sources = parsed.sources ?? [];
                setPendingSources(sources);
              } else if (parsed.type === "timeline_snapshot") {
                // Timeline events from the new TimelineStore integration.
                // These are flat TaskRecord[] from the backend's TimelineAdapter.
                if (Array.isArray(parsed.tasks)) {
                  // Merge: backend snapshot is authoritative for known stepLabels.
                  // Preserve placeholder ORDER (the user sees a stable layout)
                  // while swapping each placeholder with the real backend task
                  // when available. Any placeholder whose stepLabel has NOT
                  // been emitted yet (e.g. `generateResponse` is still running,
                  // or a node was skipped like `searchKnowledge` in auto mode
                  // for weekly_report queries) is kept as-is.
                  const incoming = parsed.tasks as TaskRecord[];
                  const incomingByLabel = new Map(
                    incoming.map((t) => [t.stepLabel, t] as const)
                  );
                  const currentPlaceholders = streamingTasksRef.current;
                  // Walk the placeholder list (stable order) and substitute
                  // each with the real backend task when available.
                  const merged: TaskRecord[] = [];
                  const seenLabels = new Set<string>();
                  for (const ph of currentPlaceholders) {
                    if (!ph.id.startsWith("placeholder-")) continue;
                    const real = incomingByLabel.get(ph.stepLabel);
                    if (real) {
                      merged.push(real);
                      seenLabels.add(ph.stepLabel);
                    } else {
                      // Backend hasn't emitted this node yet (or skipped it).
                      // Keep the placeholder so the layout stays stable.
                      merged.push(ph);
                    }
                  }
                  // Append backend tasks for stepLabels not in the placeholder
                  // list (e.g. `humanConfirmation` when pending_human_action
                  // fires after the initial placeholder set was rendered).
                  for (const t of incoming) {
                    if (!seenLabels.has(t.stepLabel)) {
                      merged.push(t);
                    }
                  }
                  streamingTasksRef.current = merged;
                  setStreamingTasks(merged);
                  setTimelineTasks(merged);
                }
              } else if (parsed.type === "done") {
                setActiveToolCall(null);
                setToolCallChain([]);
                // Snapshot streaming tasks via ref — captured before clearing.
                // Any placeholder still in `running` means the backend never
                // emitted its final snapshot (e.g. graph short-circuited);
                // mark them as `success` so the timeline doesn't end with
                // a stuck spinner.
                const finalTasks = streamingTasksRef.current.length > 0
                  ? streamingTasksRef.current.map((t) =>
                      t.id.startsWith("placeholder-") && t.status === "running"
                        ? { ...t, status: "success" as const, endTime: Date.now() }
                        : t,
                    )
                  : undefined;
                streamingTasksRef.current = finalTasks ?? [];
                setStreamingTasks(finalTasks ?? []);
                // Calculate total thinking time for the assistant message
                const totalThinkingMs =
                  finalTasks && finalTasks.length > 0
                    ? (() => {
                        const starts = finalTasks.map((t) => t.startTime).filter((v) => Number.isFinite(v));
                        const ends = finalTasks
                          .map((t) => t.endTime)
                          .filter((v): v is number => v !== undefined && Number.isFinite(v));
                        if (starts.length === 0) return undefined;
                        if (ends.length === 0) return undefined;
                        return Math.max(...ends) - Math.min(...starts);
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

  const handleStartWorkflow = useCallback((workflowType: string) => {
    // Optimistically switch mode immediately — don't wait for API.
    // POST /api/ai/workflows runs in the background; if it fails the user
    // is already in work mode with an empty/loading list (graceful degradation).
    setWorkflowMatch(null);
    setIsLoading(false);
    onStartWorkflow?.(workflowType);

    // Fire-and-forget: start workflow server-side, linked to current conversation
    void (async () => {
      try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);

        await fetch("/api/ai/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowType,
            weekStart: monday.toISOString(),
            weekEnd: sunday.toISOString(),
            conversationId: conversationId, // Link to current conversation
          }),
        });
      } catch (err) {
        console.error("[AiChatPanel] background workflow start error:", err);
      }
    })();
  }, [onStartWorkflow, conversationId]);

  const handleWorkflowDismiss = useCallback(() => {
    setWorkflowMatch(null);
  }, []);

  const handleClear = useCallback(() => {
    setMessages(
      isPage
        ? []
        : [
            {
              id: "welcome",
              role: "assistant",
              content:
                "对话已清空。有什么可以帮你的吗？",
            },
          ]
    );
  }, [isPage]);

  const padding = isPage ? "p-6" : "p-3";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div
        className={`flex items-center justify-between border-b border-ink-200 ${
          isPage ? "px-6 py-4" : "px-4 py-3"
        } ${!isPage ? "pr-12" : ""}`}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-sm">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <div>
              <p className={`font-semibold text-ink-900 ${isPage ? "text-base" : "text-sm"}`}>
                小星 · AI 助手
              </p>
              <p className="text-xs text-ink-400">
                {aiMode === "auto"
                    ? "智能检测中"
                    : aiMode === "search"
                      ? "知识检索模式"
                      : aiMode === "image"
                        ? "生图模式"
                        : aiMode === "video"
                          ? "视频模式"
                          : "通用对话模式"}
              </p>
            </div>
            {onSwitchToWorkMode && (
              <button
                type="button"
                onClick={onSwitchToWorkMode}
                className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
                title="切换到工作模式"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                工作模式
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ModelSelector
            value={selectedModel}
            onChange={(model) => {
              setSelectedModel(model);
              // 同时保存到全局和当前模式类别特定的 key
              localStorage.setItem("preferredModel", model);
              const modeCategory = getModeCategory(aiMode);
              localStorage.setItem(`preferredModel_${modeCategory}`, model);
            }}
            autoMode={aiMode === "auto"}
            category={aiMode === "image" ? "image" : aiMode === "video" ? "video" : "chat"}
            toolMode={chatToolMode}
          />
          <div className="mx-1 h-4 w-px bg-ink-200" />
          <div className="flex items-center rounded-lg bg-ink-100 p-0.5">
            {AI_MODE_OPTIONS.map((option) => (
              <div key={option.key} className="relative">
                <button
                  onClick={() => {
                    if (option.key === "chat") {
                      setAiMode("chat");
                      setChatToolModeOpen((v) => !v);
                    } else {
                      setAiMode(option.key);
                    }
                  }}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-all ${
                    (aiMode === option.key || (option.key === "chat" && (aiMode === "chat" || aiMode === "search" || aiMode === "web")))
                      ? "bg-white text-brand-700 shadow-sm"
                      : "text-ink-500 hover:text-ink-700"
                  }`}
                  title={option.description}
                >
                  {/* Dynamic label: when in chat sub-mode, show the sub-mode label */}
                  {(option.key === "chat"
                    ? CHAT_SUB_MODE_OPTIONS.find(s => s.key === chatToolMode)?.label ?? "通用对话"
                    : option.label)}
                  {option.key === "chat" && (
                    <svg className={`ml-0.5 inline h-2.5 w-2.5 transition-transform ${chatToolModeOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  )}
                </button>
                {/* Chat sub-mode dropdown */}
                {option.key === "chat" && chatToolModeOpen && (
                  <div
                    ref={chatToolModeDropdownRef}
                    className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-lg border border-ink-200 bg-white shadow-base"
                  >
                    {CHAT_SUB_MODE_OPTIONS.map((sub: { key: ChatToolMode; label: string; icon: string }) => (
                      <button
                        key={sub.key}
                        onClick={() => {
                          setChatToolMode(sub.key);
                          setAiMode(sub.key === "chat" ? "chat" : sub.key);
                          setChatToolModeOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors first:rounded-t-lg last:rounded-b-lg ${
                          chatToolMode === sub.key
                            ? "bg-brand-50 text-brand-700 font-medium"
                            : "text-ink-700 hover:bg-ink-50"
                        }`}
                      >
                        <span>{sub.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={handleClear}
            className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100"
            aria-label="清空对话"
            title="清空对话"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* User Profile Panel — page variant only */}
      {isPage && (
        <UserProfilePanel
          profile={userProfile}
          onChange={(next) => setUserProfile(next)}
        />
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
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 shadow-sm">
                <IconSparkles className="h-8 w-8 text-white" />
              </div>
              <p className="text-base font-semibold text-ink-700">开始对话吧</p>
              <p className="mt-1.5 max-w-xs text-sm text-ink-400">
                发送消息开启与小星的对话，历史记录会自动保存
              </p>
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

      {/* Workflow Match Dialog */}
      {/* Workflow Match Card */}
      <WorkflowMatchCard
        isOpen={!!workflowMatch}
        workflowType={workflowMatch?.workflowType ?? ""}
        workflowName={workflowMatch?.workflowName ?? ""}
        description={workflowMatch?.description ?? ""}
        onStartWorkflow={handleStartWorkflow}
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
        />
      </div>
    </div>
  );
}
