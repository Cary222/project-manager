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
  type AiMode,
  type TaskRecord,
  buildStepPlan,
} from "@/features/ai/types";
import { shouldUseRag, shouldUseWebSearch } from "@/features/ai/search/detector";
import { IconSparkles, IconX } from "@/shared/ui/icons";

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
  // When true and the active conversation is brand-new (just created by the
  // parent's "新对话" button), trigger an AI greeting based on the user's
  // profile. The greeting runs as an SSE stream and is persisted as the
  // first assistant message of the conversation.
  autoGreet?: boolean;
  // Called once a greeting has been triggered (or failed) so the parent can
  // clear the pending flag for this conversation.
  onGreetingConsumed?: (id: string) => void;
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function AiChatPanel({
  variant = "page",
  conversationId,
  onConversationCreated,
  autoGreet = false,
  onGreetingConsumed,
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
  // Load preferred model from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("preferredModel");
    if (saved) setSelectedModel(saved);
  }, []);

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

  // Keep refs in sync with state — useLayoutEffect runs synchronously after
  // render, avoiding the "Cannot update ref during render" lint error.
  useLayoutEffect(() => {
    messagesRef.current = messages;
    aiModeRef.current = aiMode;
    selectedModelRef.current = selectedModel;
  });

  // ─── Load conversation messages ─────────────────────────────────────────────

  const loadMessages = useCallback(
    async (convId: string, version: number) => {
      setIsMessagesLoading(true);
      try {
        const res = await fetch(`/api/ai/conversations/${convId}`);
        if (version !== conversationVersionRef.current) return;
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
              }) => ({
                id: m.id,
                role: m.role as "user" | "assistant",
                content: m.content,
                sources: m.sources as SourceReference[] | undefined,
                thinkingSteps: (() => {
                  const steps = (m.metadata as { thinkingSteps?: TaskRecord[] } | undefined)
                    ?.thinkingSteps;
                  if (!Array.isArray(steps)) return undefined;
                  // Ensure timestamps are numbers (DB JSON may parse them as strings)
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

  // Cleanup: cancel any active typewriter when this component unmounts or
  // when the user switches to a different conversation.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (welcomeTypewriterRef.current?.timerId) {
        clearInterval(welcomeTypewriterRef.current.timerId);
      }
      welcomeTypewriterRef.current = null;
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

  // ─── Send message ───────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (message: string) => {
      const conversationVersion = conversationVersionRef.current;
      const requestController = new AbortController();
      const tempUserId = `user-${Date.now()}`;

      // Optimistically add user message immediately so it shows up while the
      // AI stream is in flight, regardless of whether this is a new or
      // existing conversation. The server will later persist it on its own.
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: "user", content: message },
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
          body = { message, conversationHistory, mode, forceSearch: useSearch, useWebSearch, modelName };
        } else {
          url = "/api/ai/conversations";
          body = { firstMessage: message, conversationHistory, mode, forceSearch: useSearch, useWebSearch, modelName };
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
                setMessages((prev) => [...prev, assistantMessage]);
                setIsLoading(false);
                setStreamingContent("");
                setPendingSources([]);
                // thinkingSteps now lives inside the bubble — no external collapse timer needed
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
    [conversationId, onConversationCreated]
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
          <div>
            <p className={`font-semibold text-ink-900 ${isPage ? "text-base" : "text-sm"}`}>
              小星 · AI 助手
            </p>
            <p className="text-xs text-ink-400">
              {conversationId
                ? "加载历史对话中…"
                : aiMode === "auto"
                  ? "智能检测中"
                  : aiMode === "search"
                    ? "知识检索模式"
                    : "通用对话模式"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ModelSelector
            value={selectedModel}
            onChange={(model) => {
              setSelectedModel(model);
              localStorage.setItem("preferredModel", model);
            }}
          />
          <div className="mx-1 h-4 w-px bg-ink-200" />
          <div className="flex items-center rounded-lg bg-ink-100 p-0.5">
            {AI_MODE_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => setAiMode(option.key)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-all ${
                  aiMode === option.key
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-ink-500 hover:text-ink-700"
                }`}
                title={option.description}
              >
                {option.label}
              </button>
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

      {/* Input */}
      <div className={`border-t border-ink-200 ${isPage ? "p-6" : "p-3"}`}>
        <AiChatInput
          onSend={handleSend}
          onStop={handleStop}
          isGenerating={isLoading}
          placeholder={isPage ? "输入问题，向小星提问…" : "输入问题..."}
        />
      </div>
    </div>
  );
}
