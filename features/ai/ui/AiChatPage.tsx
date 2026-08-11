"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AiChatPanel } from "./AiChatPanel";
import { AiConversationSidebar, type ConversationCategory } from "./AiConversationSidebar";
import { WorkModePanel } from "./work/WorkModePanel";
import { WorkflowStatus } from "./work/WorkflowStatus";

type ChatMode = "conversation" | "work";

function AiChatPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Chat mode: default to work if URL says so, otherwise conversation
  const [mode, setMode] = useState<ChatMode>(() => {
    return searchParams.get("m") === "work" ? "work" : "conversation";
  });

  // Active conversation ID: initialize from URL query string
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    return searchParams.get("c") || null;
  });

  // Category filter for conversation sidebar
  const [conversationCategory, setConversationCategory] = useState<ConversationCategory>("ALL");

  // Selected workflow run — controls the right-side detail panel
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Tracks IDs of conversations that were just freshly created in this
  // session, so AiChatPanel knows to auto-greet them (AI proactively says
  // hi based on the user's profile).
  const [pendingGreetingIds, setPendingGreetingIds] = useState<Set<string>>(new Set());

  // Bootstrap flag: makes sure the "auto-pick most recent" effect runs at
  // most once per mount. Without it, React StrictMode (and any future
  // re-render that re-creates the effect deps) would re-fetch and could
  // re-trigger the "no conversations → auto-create" path twice.
  const [bootstrapped, setBootstrapped] = useState(false);

  // Keep a ref to handleNewConversation so the bootstrap effect can call it
  // without listing it as a dep (which would re-run on every render).
  const handleNewConversationRef = useRef<(() => Promise<void>) | null>(null);

  // Sync activeId → URL. Only call router.replace when the query string
  // actually changes; otherwise the new searchParams reference triggers
  // this effect again on every render and we end up in a replace loop that
  // re-fetches the page (and re-runs every child effect) once a second.
  useEffect(() => {
    const currentC = searchParams.get("c");
    if (currentC === activeConversationId) return;

    const params = new URLSearchParams(searchParams.toString());
    if (activeConversationId) {
      params.set("c", activeConversationId);
    } else {
      params.delete("c");
    }
    const newQuery = params.toString();
    const newUrl = newQuery ? `${pathname}?${newQuery}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [activeConversationId, pathname, router, searchParams]);

  // Bootstrap: when the user lands on /ai without ?c=, pick the most recent
  // conversation (server already sorts by lastMessageAt desc) — or, if they
  // have no conversations yet, kick off a new one with the AI greeting.
  useEffect(() => {
    if (bootstrapped) return;
    // If the URL already pins a conversation, don't override it.
    if (searchParams.get("c")) {
      setBootstrapped(true);
      return;
    }

    void (async () => {
      try {
        const res = await fetch("/api/ai/conversations");
        if (!res.ok) {
          setBootstrapped(true);
          return;
        }
        const json = await res.json();
        const list: Array<{ id: string }> = Array.isArray(json?.data)
          ? json.data
          : [];
        if (list.length > 0) {
          // list[0] is the most recently active conversation.
          setActiveConversationId(list[0].id);
        } else {
          // No conversations yet — create one and let AiChatPanel greet.
          await handleNewConversationRef.current?.();
        }
      } catch (err) {
        console.error("[AiChatPage] bootstrap error:", err);
      } finally {
        setBootstrapped(true);
      }
    })();
    // Intentionally only depend on `bootstrapped` so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped]);

  const handleSelect = useCallback((id: string | null) => {
    setActiveConversationId(id);
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  // AiChatPanel 报 404 → 清掉失效 id，避免下次重渲染再次请求
  const handleConversationMissing = useCallback((id: string) => {
    setActiveConversationId((current) => (current === id ? null : current));
  }, []);

  // "New chat" button handler: create an empty conversation, mark it for
  // greeting, and switch to it.
  const handleNewConversation = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const json = await res.json();
      const id = json?.data?.id as string | undefined;
      if (!id) return;
      setPendingGreetingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setActiveConversationId(id);
    } catch {
      // silently ignore — user can retry
    }
  }, []);

  // Keep the ref pointing at the latest handleNewConversation so the
  // bootstrap effect always calls the freshest version.
  useEffect(() => {
    handleNewConversationRef.current = handleNewConversation;
  }, [handleNewConversation]);

  const handleGreetingConsumed = useCallback((id: string) => {
    setPendingGreetingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleSwitchToWorkMode = useCallback(() => {
    setMode("work");
    setSelectedRunId(null);
  }, []);

  // 工作流结束跳转周报页：同一 runId 在浏览器会话内只跳一次
  // 跨页面刷新也持久化：避免用户进入工作模式时所有已完成 run 都触发跳转
  const NAVIGATED_RUN_IDS_KEY = "pm:navigatedRunIds";
  const navigatedRunIdsRef = useRef<Set<string> | null>(null);
  if (navigatedRunIdsRef.current === null) {
    let initial = new Set<string>();
    if (typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(NAVIGATED_RUN_IDS_KEY);
        if (raw) initial = new Set(JSON.parse(raw) as string[]);
      } catch {
        // ignore
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
      // ignore quota / private mode
    }
  }, []);
  const handleWorkflowApproved = useCallback(
    (runId: string, reportId: string) => {
      const set = navigatedRunIdsRef.current;
      if (!set || set.has(runId)) return;
      recordNavigated(runId);
      router.push(`/reports/weekly-reports/${reportId}?from=/ai&mode=work`);
    },
    [router, recordNavigated],
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

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-row rounded-2xl border border-ink-200 bg-white shadow-soft">
      {mode === "conversation" ? (
        <AiConversationSidebar
          activeId={activeConversationId}
          onSelect={handleSelect}
          onNewConversation={handleNewConversation}
          onSwitchToWorkMode={handleSwitchToWorkMode}
          category={conversationCategory}
          onCategoryChange={setConversationCategory}
        />
      ) : (
        <WorkModePanel
          onSelectRun={(runId, conversationId) => {
            setSelectedRunId(runId);
            // If workflow is linked to a conversation, switch to conversation mode
            if (conversationId) {
              setMode("conversation");
              setActiveConversationId(conversationId);
            }
          }}
        />
      )}
      <main className="min-w-0 flex-1 overflow-hidden">
        {mode === "conversation" ? (
          <AiChatPanel
            variant="page"
            conversationId={activeConversationId}
            onConversationCreated={handleConversationCreated}
            autoGreet={pendingGreetingIds.has(activeConversationId ?? "")}
            onGreetingConsumed={handleGreetingConsumed}
            onSwitchToWorkMode={handleSwitchToWorkMode}
            onStartWorkflow={handleSwitchToWorkMode}
            onConversationMissing={handleConversationMissing}
          />
        ) : selectedRunId ? (
          <div
            className="flex h-full flex-col p-6"
            data-testid="workflow-detail-panel"
          >
            <button
              onClick={() => {
                setSelectedRunId(null);
                setMode("work");
              }}
              className="mb-4 flex w-fit items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-800"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              返回列表
            </button>
            <div className="flex-1 overflow-y-auto">
              <WorkflowStatus
                runId={selectedRunId}
                onApproved={(runId, reportId) => handleWorkflowApproved(runId, reportId)}
                onDone={(runId, snap) => {
                  if (snap?.reportId) {
                    handleWorkflowDone(runId, snap.reportId);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-ink-500">
            <div className="text-center">
              <svg
                className="mx-auto mb-4 h-12 w-12 text-ink-300"
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
              <p className="text-sm font-medium">工作流面板</p>
              <p className="mt-1 text-xs text-ink-400">在左侧发起和管理工作流</p>
              <button
                onClick={() => {
                  setMode("conversation");
                  setActiveConversationId(null);
                }}
                className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                发起对话
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AiChatPage() {
  return (
    <Suspense>
      <AiChatPageInner />
    </Suspense>
  );
}