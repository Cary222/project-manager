"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AiChatPanel } from "./AiChatPanel";
import { AiConversationSidebar, type ConversationCategory } from "./AiConversationSidebar";
import { AiWelcomeView } from "./AiWelcomeView";
import { AiWorkspaceLayout } from "./layout/AiWorkspaceLayout";
import { AiRightInspectorPanel } from "./AiRightInspectorPanel";
import { WorkDashboard } from "@/features/ai/ui/ai-work/WorkDashboard";
import type { WorkRoute } from "@/features/ai/agents/work/runtime/work-run-ref";
import type { AiUserProfile } from "./UserProfilePanel";
import type { AiMode, ChatToolMode } from "@/features/ai/types/modes";
import type { ReasoningLevel } from "@/features/ai/llm/model-reasoning";
import type { RagTrace } from "@/features/ai/search/rag-trace";

type ChatMode = "conversation" | "work";

function AiChatPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Mode: conversation vs work
  const mode: ChatMode = searchParams.get("m") === "work" ? "work" : "conversation";

  // Active conversation ID from URL
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    return searchParams.get("c") || null;
  });

  // Pending initial message to send when starting chat from WelcomeView
  const [pendingInitialMessage, setPendingInitialMessage] = useState<string | null>(null);
  const [pendingInitialImages, setPendingInitialImages] = useState<
    { id: string; url: string; name: string }[] | undefined
  >(undefined);

  // Panel collapse states (three-panel folding)
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [ragTrace, setRagTrace] = useState<RagTrace | null>(null);

  // Category filter for conversation sidebar
  const [conversationCategory, setConversationCategory] = useState<ConversationCategory>("ALL");

  // Synchronized AI Model across WelcomeView, ChatPanel, and RightInspectorPanel
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("preferredModel");
      if (saved) return saved;
    }
    return "agnes:agnes-2.5-flash";
  });

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    if (typeof window !== "undefined") {
      localStorage.setItem("preferredModel", model);
    }
  }, []);

  // User profile for right inspector (loaded on mount so it's ready immediately)
  const [userProfile, setUserProfile] = useState<AiUserProfile | null>(null);
  const [aiMode, setAiMode] = useState<AiMode>("auto");
  const [chatToolMode, setChatToolMode] = useState<ChatToolMode>("chat");
  const [thinkingLevel, setThinkingLevel] = useState<ReasoningLevel>("high");
  const [clearTrigger, setClearTrigger] = useState(0);

  const handleClearConversation = useCallback(() => {
    setClearTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/ai/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!ignore && json?.data?.profile) {
          setUserProfile(json.data.profile as AiUserProfile);
        }
      })
      .catch((err) => console.error("[AiChatPage] loadProfile error:", err));
    return () => {
      ignore = true;
    };
  }, []);

  // 单向响应外部路由参数变化（如初次载入、浏览器前进后退），杜绝双向 setState 环路
  const prevUrlCRef = useRef<string | null>(searchParams.get("c") || null);
  useEffect(() => {
    const currentUrlC = searchParams.get("c") || null;
    if (currentUrlC !== prevUrlCRef.current) {
      prevUrlCRef.current = currentUrlC;
      setActiveConversationId(currentUrlC);
    }
  }, [searchParams]);

  // Handle selecting a conversation from the sidebar
  const handleSelect = useCallback((id: string | null) => {
    setPendingInitialMessage(null);
    setPendingInitialImages(undefined);
    setActiveConversationId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set("c", id);
    } else {
      params.delete("c");
    }
    // 当在 Work 模式下点击具体的历史对话时，无缝切换到 Chat 视图呈现完整历史记录
    if (mode === "work" && id) {
      params.delete("m");
      params.delete("goal");
      params.delete("route");
      const newQuery = params.toString();
      router.replace(newQuery ? `${pathname}?${newQuery}` : pathname, { scroll: false });
    } else {
      const newQuery = params.toString();
      window.history.replaceState(null, "", newQuery ? `${pathname}?${newQuery}` : pathname);
    }
  }, [mode, pathname, router, searchParams]);

  // When a new conversation is created by AiChatPanel
  const handleConversationCreated = useCallback((id: string) => {
    setActiveConversationId(id);
    setPendingInitialMessage(null);
    setPendingInitialImages(undefined);
    const params = new URLSearchParams(searchParams.toString());
    params.set("c", id);
    const newQuery = params.toString();
    window.history.replaceState(null, "", newQuery ? `${pathname}?${newQuery}` : pathname);
  }, [pathname, searchParams]);

  // When a conversation is deleted or 404s
  const handleConversationMissing = useCallback((id: string) => {
    setActiveConversationId((current) => (current === id ? null : current));
  }, []);

  // "New chat" button in sidebar: resets to Welcome page
  const handleNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setPendingInitialMessage(null);
    setPendingInitialImages(undefined);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("c");
    params.delete("goal");
    params.delete("route");
    if (mode === "work") {
      params.delete("m");
    }
    const newQuery = params.toString();
    router.replace(newQuery ? `${pathname}?${newQuery}` : pathname, { scroll: false });
  }, [mode, pathname, router, searchParams]);

  // Switching between Chat and Work modes
  const handleSwitchToWorkMode = useCallback(
    (
      workflowType?: string,
      goalPrompt?: string,
      handoffContext?: { conversationId?: string; projectId?: string; ticketId?: string }
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("m", "work");
      const targetConvId = handoffContext?.conversationId ?? activeConversationId;
      if (targetConvId) {
        params.set("c", targetConvId);
      } else {
        params.delete("c");
      }
      if (goalPrompt) {
        params.set("goal", goalPrompt);
      } else {
        params.delete("goal");
      }
      if (workflowType) {
        params.set("route", workflowType);
      } else {
        params.delete("route");
      }
      if (handoffContext?.projectId) {
        params.set("projectId", handoffContext.projectId);
      }
      if (handoffContext?.ticketId) {
        params.set("ticketId", handoffContext.ticketId);
      }
      const newQuery = params.toString();
      router.replace(`${pathname}?${newQuery}`, { scroll: false });
    },
    [activeConversationId, pathname, router, searchParams]
  );

  const handleSwitchToConversation = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("m");
    params.delete("goal");
    params.delete("route");
    if (activeConversationId) {
      params.set("c", activeConversationId);
    }
    const newQuery = params.toString();
    const newUrl = newQuery ? `${pathname}?${newQuery}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [activeConversationId, pathname, router, searchParams]);

  // Handle start chat from WelcomeView
  const handleStartChat = useCallback(
    async (message: string, modelName: string, images?: { id: string; url: string; name: string }[]) => {
      if (modelName) handleModelChange(modelName);
      if (mode === "work") {
        handleSwitchToConversation();
      }
      let newConvId: string | null = null;
      try {
        const res = await fetch("/api/ai/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: message.slice(0, 30) || "新对话",
            category: "CHAT",
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data?.id) {
            newConvId = json.data.id;
            setActiveConversationId(newConvId);
          }
        }
      } catch (err) {
        console.error("[AiChatPage] create conversation error:", err);
      }
      setPendingInitialMessage(message);
      setPendingInitialImages(images);
    },
    [handleModelChange, handleSwitchToConversation, mode]
  );

  // Handle start work from WelcomeView
  const handleStartWork = useCallback(
    (goal: string, route?: WorkRoute, modelName?: string) => {
      if (modelName) handleModelChange(modelName);
      handleSwitchToWorkMode(route, goal);
    },
    [handleModelChange, handleSwitchToWorkMode]
  );

  // Determine whether to show the Welcome View
  const isWorkMode = mode === "work";
  const hasActiveChat = Boolean(activeConversationId || pendingInitialMessage);
  const showWelcomeView = !isWorkMode && !hasActiveChat;

  // Top Bar Center: Mode Segmented Switch (Chat 💬 vs Work ⚡)
  const topBarCenter = (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center rounded-lg border border-ink-200 bg-ink-100/80 p-0.5 text-xs shadow-2xs">
        <button
          type="button"
          onClick={isWorkMode ? handleSwitchToConversation : undefined}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
            !isWorkMode
              ? "bg-white text-brand-700 shadow-xs ring-1 ring-black/5"
              : "text-ink-600 hover:text-ink-900"
          }`}
        >
          <span>💬</span>
          <span>Chat 对话</span>
        </button>
        <button
          type="button"
          onClick={!isWorkMode ? () => handleSwitchToWorkMode() : undefined}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
            isWorkMode
              ? "bg-white text-brand-700 shadow-xs ring-1 ring-black/5"
              : "text-ink-600 hover:text-ink-900"
          }`}
        >
          <span>⚡</span>
          <span>Work 工作台</span>
          <span className="rounded bg-brand-50 px-1 py-0.2 text-[10px] font-semibold text-brand-700">
            Agent
          </span>
        </button>
      </div>
    </div>
  );

  // Top Bar Right Actions (Empty, right panel toggle is rendered by AiWorkspaceLayout)
  const topBarRight = null;

  // Common Left Sidebar component
  const sidebarContent = (
    <AiConversationSidebar
      activeId={activeConversationId}
      onSelect={handleSelect}
      onCollapse={() => setSidebarOpen(false)}
      onNewConversation={handleNewConversation}
      category={conversationCategory}
      onCategoryChange={setConversationCategory}
    />
  );

  // 1. Work Mode: WorkDashboard provides mainPanel and previewPanel to AiWorkspaceLayout
  if (isWorkMode) {
    return (
      <div className="h-[calc(100vh-8rem)] w-full overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-soft">
        <WorkDashboard
          conversationId={activeConversationId ?? searchParams.get("c") ?? undefined}
          onConversationCreated={(newConvId) => {
            setActiveConversationId(newConvId);
          }}
          onSwitchToConversation={handleSwitchToConversation}
          initialGoal={searchParams.get("goal") ?? undefined}
          initialRoute={(searchParams.get("route") as WorkRoute) ?? undefined}
          onTogglePreviewPanel={() => setRightPanelOpen((prev) => !prev)}
        >
          {({ mainPanel, previewPanel }) => (
            <AiWorkspaceLayout
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              rightPanelOpen={rightPanelOpen}
              onToggleRightPanel={() => setRightPanelOpen((prev) => !prev)}
              topBarCenter={topBarCenter}
              topBarRight={topBarRight}
              sidebar={sidebarContent}
              rightPanel={previewPanel}
            >
              {mainPanel}
            </AiWorkspaceLayout>
          )}
        </WorkDashboard>
      </div>
    );
  }

  // 2. Chat / Welcome Mode: AiWorkspaceLayout hosts AiRightInspectorPanel in the right panel slot
  return (
    <div className="h-[calc(100vh-8rem)] w-full overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-soft">
      <AiWorkspaceLayout
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        rightPanelOpen={rightPanelOpen}
        onToggleRightPanel={() => setRightPanelOpen((prev) => !prev)}
        topBarCenter={topBarCenter}
        topBarRight={topBarRight}
        sidebar={sidebarContent}
        rightPanel={
          <AiRightInspectorPanel
            mode="chat"
            conversationId={activeConversationId}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            userProfile={userProfile}
            ragTrace={ragTrace}
            onUserProfileChange={setUserProfile}
            onClose={() => setRightPanelOpen(false)}
            aiMode={aiMode}
            onAiModeChange={setAiMode}
            chatToolMode={chatToolMode}
            onChatToolModeChange={setChatToolMode}
            onSwitchToWorkMode={() => handleSwitchToWorkMode()}
            onClearConversation={handleClearConversation}
          />
        }
      >
        {showWelcomeView ? (
          <AiWelcomeView
            initialMode="chat"
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            onStartChat={handleStartChat}
            onStartWork={handleStartWork}
          />
        ) : (
          <AiChatPanel
            variant="page"
            conversationId={activeConversationId}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            aiMode={aiMode}
            onAiModeChange={setAiMode}
            chatToolMode={chatToolMode}
            onChatToolModeChange={setChatToolMode}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={setThinkingLevel}
            clearTrigger={clearTrigger}
            onRagTraceChange={setRagTrace}
            initialMessage={pendingInitialMessage}
            initialImages={pendingInitialImages}
            onConversationCreated={handleConversationCreated}
            onSwitchToWorkMode={() => handleSwitchToWorkMode()}
            onStartWorkflow={handleSwitchToWorkMode}
            onConversationMissing={handleConversationMissing}
          />
        )}
      </AiWorkspaceLayout>
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
