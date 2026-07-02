"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AiChatInput } from "./AiChatInput";
import { AiMessageBubble, type SourceReference } from "./AiMessageBubble";
import { AiTypingBubble } from "./AiTypingBubble";
import { AI_MODE_OPTIONS, type AiMode } from "@/features/ai/lib/types";
import { shouldUseRag } from "@/features/ai/lib/detector";
import { IconCheck, IconChevronDown, IconEdit, IconPlus, IconSparkles, IconX } from "@/shared/ui/icons";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatToolResult(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const o = output as Record<string, unknown>;
  if (o.error) return `错误: ${o.error}`;
  if (Array.isArray(o.results) && o.results.length > 0) return `找到 ${o.results.length} 条结果`;
  if (typeof o.answer === "string" && o.answer) return `已获取摘要`;
  if (Array.isArray(o.context) && o.context.length > 0) return `检索到 ${o.context.length} 条相关内容`;
  return "完成";
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
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

// ─── User Profile ─────────────────────────────────────────────────────────────

interface AiUserProfile {
  roles?: string[];
  interests?: string[];
  expertise?: string[];
  projects?: string[];
  recentTopics?: string[];
  preferences?: Record<string, string>;
}

interface UserProfilePanelProps {
  profile: AiUserProfile | null;
  onChange?: (next: AiUserProfile) => void;
}

function ProfileField({ label, value }: { label: string; value?: string | string[] }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  const items = Array.isArray(value) ? value : [value];
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// Editable variant of ProfileField. Renders each tag with a × delete button
// and shows an inline input + "+" button at the bottom for adding new items.
// Items are managed by the parent (UserProfilePanel) so the parent owns the
// draft → save flow.
function EditableProfileField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const current = value ?? [];
    if (current.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...current, trimmed]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(value ?? []).map((item) => (
          <span
            key={item}
            className="group/etag inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange((value ?? []).filter((x) => x !== item))}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-brand-400 transition hover:bg-brand-200 hover:text-danger"
              aria-label={`删除 ${item}`}
              title={`删除 ${item}`}
            >
              <IconX className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft("");
            }
          }}
          placeholder={`添加${label}…`}
          className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-900 outline-none transition focus:border-brand-400 focus:ring-1 focus:ring-brand-100"
          maxLength={50}
        />
        <button
          type="button"
          onClick={commit}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-0.5 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconPlus className="h-3 w-3" />
          添加
        </button>
      </div>
    </div>
  );
}

function UserProfilePanel({
  profile,
  onChange,
}: UserProfilePanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  // Local draft the user mutates before pressing "保存". Mirrors the `profile`
  // prop on mount and on any external change.
  const [draft, setDraft] = useState<AiUserProfile>(profile ?? {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep draft in sync with the latest prop. Only do this when we're NOT
  // editing, so the user's unsaved edits don't get clobbered by a refetch
  // (e.g. after switching conversations).
  useEffect(() => {
    if (!editing) setDraft(profile ?? {});
  }, [profile, editing]);

  const updateField = (field: keyof AiUserProfile, next: string[]) => {
    setDraft((d) => ({ ...d, [field]: next }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/ai/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      const saved = json?.data?.profile ?? draft;
      onChange?.(saved as AiUserProfile);
      setEditing(false);
    } catch (err) {
      console.error("[UserProfilePanel] save error:", err);
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(profile ?? {});
    setEditing(false);
    setSaveError(null);
  };

  if (!profile) {
    return (
      <div className="border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3">
          <IconSparkles className="h-4 w-4 shrink-0 text-brand-400" />
          <p className="text-xs text-ink-400">
            还没有画像，多和小星聊几句后会自动生成
          </p>
        </div>
      </div>
    );
  }

  const hasAnyField =
    profile.roles?.length ||
    profile.interests?.length ||
    profile.expertise?.length ||
    profile.projects?.length ||
    profile.recentTopics?.length ||
    Object.keys(profile.preferences ?? {}).length > 0;

  if (!hasAnyField && !editing) {
    return (
      <div className="border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3">
          <IconSparkles className="h-4 w-4 shrink-0 text-brand-400" />
          <p className="text-xs text-ink-400">
            还没有画像，多和小星聊几句后会自动生成
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-ink-100">
      <div className="flex w-full items-center justify-between px-5 py-3 transition hover:bg-ink-50">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <IconSparkles className="h-4 w-4 text-brand-500" />
          <span className="text-xs font-medium text-ink-700">用户画像摘要</span>
          {editing && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              编辑中
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setCollapsed(false);
              }}
              className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              title="编辑画像"
              aria-label="编辑画像"
            >
              <IconEdit className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            title={collapsed ? "展开" : "折叠"}
            aria-label={collapsed ? "展开画像" : "折叠画像"}
          >
            <IconChevronDown
              className={`h-4 w-4 text-ink-400 transition ${collapsed ? "" : "rotate-180"}`}
            />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-64 overflow-y-auto px-5 pb-3">
          {editing ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <EditableProfileField
                label="角色"
                value={draft.roles}
                onChange={(next) => updateField("roles", next)}
              />
              <EditableProfileField
                label="兴趣"
                value={draft.interests}
                onChange={(next) => updateField("interests", next)}
              />
              <EditableProfileField
                label="专业领域"
                value={draft.expertise}
                onChange={(next) => updateField("expertise", next)}
              />
              <EditableProfileField
                label="项目"
                value={draft.projects}
                onChange={(next) => updateField("projects", next)}
              />
              <div className="col-span-2">
                <EditableProfileField
                  label="近期话题"
                  value={draft.recentTopics}
                  onChange={(next) => updateField("recentTopics", next)}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <ProfileField label="角色" value={profile.roles} />
              <ProfileField label="兴趣" value={profile.interests} />
              <ProfileField label="专业领域" value={profile.expertise} />
              <ProfileField label="项目" value={profile.projects} />
              <div className="col-span-2">
                <ProfileField label="近期话题" value={profile.recentTopics} />
              </div>
              {profile.preferences &&
                Object.entries(profile.preferences).map(([key, val]) => (
                  <ProfileField key={key} label={key} value={val} />
                ))}
            </div>
          )}

          {editing && (
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-ink-100 pt-3">
              {saveError && (
                <p className="mr-auto text-xs text-danger">{saveError}</p>
              )}
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? (
                  "保存中…"
                ) : (
                  <>
                    <IconCheck className="h-3.5 w-3.5" />
                    保存修改
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  // Custom caption shown on the typing bubble during the auto-greeting flow,
  // so the second bubble reads "AI 正在根据你的画像主动准备问候…" instead of
  // the generic "思考中".
  const [greetingHint, setGreetingHint] = useState<string | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<{
    toolName: string;
    displayLabel: string;
    status: "calling" | "done" | "error";
    message?: string;
  } | null>(null);
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
  const prevConversationIdRef = useRef<string | null | undefined>(undefined);
  const messagesRef = useRef<Message[]>([]);
  const aiModeRef = useRef<AiMode>("auto");

  // Keep refs in sync with state — useLayoutEffect runs synchronously after
  // render, avoiding the "Cannot update ref during render" lint error.
  useLayoutEffect(() => {
    messagesRef.current = messages;
    aiModeRef.current = aiMode;
  });

  // ─── Load conversation messages ─────────────────────────────────────────────

  const loadMessages = useCallback(
    async (convId: string) => {
      setIsMessagesLoading(true);
      try {
        const res = await fetch(`/api/ai/conversations/${convId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const conv = json.data;
        if (conv?.messages && Array.isArray(conv.messages)) {
          setMessages(
            conv.messages.map((m: { id: string; role: string; content: string; sources?: SourceReference[] }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              sources: m.sources,
            }))
          );
        }
      } catch (err) {
        console.error("[AiChatPanel] load messages error:", err);
        setMessages([]);
      } finally {
        setIsMessagesLoading(false);
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
  // + `isLoading` state, which the renderer already maps to a single
  // AiMessageBubble + AiTypingBubble pair. Avoid double-rendering.
  const triggerGreeting = useCallback(
    async (convId: string) => {
      setIsLoading(true);
      setStreamingContent("");
      setPendingSources([]);
      setGreetingHint(pickGreetingHint());

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
              if (parsed.type === "text") {
                fullContent += parsed.delta;
                setStreamingContent(fullContent);
              } else if (parsed.type === "done") {
                // Commit the streamed greeting into the messages list as
                // the assistant message of the conversation.
                const greetingId = `assistant-greeting-${convId}`;
                setMessages((prev) =>
                  prev.some((m) => m.id === greetingId)
                    ? prev
                    : [
                        ...prev,
                        {
                          id: greetingId,
                          role: "assistant",
                          content: fullContent,
                        },
                      ]
                );
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
        setIsLoading(false);
        setStreamingContent("");
        setGreetingHint(null);
      }
    },
    [pickGreetingHint]
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
    (convId: string) => {
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
          void triggerGreeting(convId);
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
      if (welcomeTypewriterRef.current?.timerId) {
        clearInterval(welcomeTypewriterRef.current.timerId);
      }
      welcomeTypewriterRef.current = null;
    };
  }, []);

  // ─── Respond to conversationId changes ──────────────────────────────────────

  useEffect(() => {
    void (async () => {
      if (conversationId === prevConversationIdRef.current) return;
      prevConversationIdRef.current = conversationId;

      if (conversationId) {
        await loadMessages(conversationId);
        if (isPage) await loadProfile();
        // If the parent flagged this conversation as needing an AI greeting
        // (i.e. it was just created via the "新对话" button), play the
        // preset-welcome typewriter, which itself fires triggerGreeting once
        // the welcome text has been fully revealed.
        if (autoGreet) {
          playWelcomeTypewriter(conversationId);
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

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        const conversationHistory = messagesRef.current.slice(-10).map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
        }));

        const mode = aiModeRef.current;
        const useSearch = mode === "search" || (mode === "auto" && shouldUseRag(message));

        // Determine endpoint and body
        let url: string;
        let body: Record<string, unknown>;

        if (conversationId) {
          url = `/api/ai/conversations/${conversationId}/messages`;
          body = { message, conversationHistory, mode, forceSearch: useSearch };
        } else {
          url = "/api/ai/conversations";
          body = { firstMessage: message, conversationHistory, mode, forceSearch: useSearch };
        }

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: abortControllerRef.current.signal,
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
              } else if (parsed.type === "done") {
                setActiveToolCall(null);
                const assistantMessage: Message = {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  content: fullContent,
                  sources: sources.length > 0 ? sources : undefined,
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setIsLoading(false);
                setStreamingContent("");
                setPendingSources([]);
              } else if (parsed.type === "tool_call") {
                const toolLabel =
                  parsed.toolName === "webSearch"
                    ? "联网搜索"
                    : parsed.toolName === "searchKnowledge"
                      ? "知识检索"
                      : parsed.toolName;
                setActiveToolCall({
                  toolName: parsed.toolName,
                  displayLabel: toolLabel,
                  status: "calling",
                });
              } else if (parsed.type === "tool_result") {
                if (activeToolCall?.toolName === parsed.toolName) {
                  setActiveToolCall((prev) =>
                    prev ? { ...prev, status: "done", message: formatToolResult(parsed.output) } : null
                  );
                }
              } else if (parsed.type === "tool_error") {
                if (activeToolCall?.toolName === parsed.toolName) {
                  setActiveToolCall((prev) =>
                    prev ? { ...prev, status: "error", message: parsed.error } : null
                  );
                }
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
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        console.error("Chat error:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: "抱歉，生成回答时遇到了问题。请稍后重试。",
          },
        ]);
        setIsLoading(false);
        setStreamingContent("");
        setActiveToolCall(null);
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
          {/* Loading skeleton */}
          {isMessagesLoading && (
            <>
              <div className="flex gap-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-ink-200 animate-pulse" />
                <div className="space-y-2">
                  <div className="h-4 w-48 rounded bg-ink-200 animate-pulse" />
                  <div className="h-4 w-72 rounded bg-ink-100 animate-pulse" />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-ink-200 animate-pulse" />
                <div className="space-y-2">
                  <div className="h-4 w-64 rounded bg-ink-200 animate-pulse" />
                  <div className="h-4 w-56 rounded bg-ink-100 animate-pulse" />
                </div>
              </div>
            </>
          )}

          {/* Message list */}
          {!isMessagesLoading &&
            messages.map((msg) => (
              <AiMessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                sources={msg.sources}
              />
            ))}

          {/* Typing indicator — uses `greetingHint` (if set) for the caption so
              the auto-greet flow can show "AI 正在主动准备问候…" instead of
              the generic "思考中". */}
          {isLoading && !streamingContent && (
            <AiTypingBubble text={greetingHint ?? undefined} />
          )}

          {/* Tool call status indicator */}
          {activeToolCall && (
            <div
              className={`mx-4 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                activeToolCall.status === "error"
                  ? "bg-danger-50 text-danger-700"
                  : activeToolCall.status === "done"
                    ? "bg-success-50 text-success-700"
                    : "bg-brand-50 text-brand-700"
              }`}
            >
              {activeToolCall.status === "calling" && (
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              )}
              {activeToolCall.status === "done" && <IconCheck className="h-3 w-3" />}
              {activeToolCall.status === "error" && <IconX className="h-3 w-3" />}
              <span>
                {activeToolCall.status === "calling" && `正在使用 ${activeToolCall.displayLabel}…`}
                {activeToolCall.status === "done" && `${activeToolCall.displayLabel} 完成`}
                {activeToolCall.status === "error" && `${activeToolCall.displayLabel} 失败`}
                {activeToolCall.message && ` — ${activeToolCall.message}`}
              </span>
            </div>
          )}

          {/* Streaming message */}
          {isLoading && streamingContent && (
            <AiMessageBubble
              role="assistant"
              content={streamingContent}
              sources={pendingSources.length > 0 ? pendingSources : undefined}
              isStreaming
            />
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
