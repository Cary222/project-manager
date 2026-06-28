"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AiChatPanel } from "./AiChatPanel";
import { AiConversationSidebar } from "./AiConversationSidebar";

function AiChatPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Active conversation ID: initialize from URL query string
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    return searchParams.get("c") || null;
  });

  // Tracks IDs of conversations that were just freshly created in this
  // session, so AiChatPanel knows to auto-greet them (AI proactively says
  // hi based on the user's profile).
  const [pendingGreetingIds, setPendingGreetingIds] = useState<Set<string>>(new Set());

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

  const handleSelect = useCallback((id: string | null) => {
    setActiveConversationId(id);
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setActiveConversationId(id);
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

  const handleGreetingConsumed = useCallback((id: string) => {
    setPendingGreetingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-row rounded-2xl border border-ink-200 bg-white shadow-soft">
      <AiConversationSidebar
        activeId={activeConversationId}
        onSelect={handleSelect}
        onNewConversation={handleNewConversation}
      />
      <main className="min-w-0 flex-1 overflow-hidden">
        <AiChatPanel
          variant="page"
          conversationId={activeConversationId}
          onConversationCreated={handleConversationCreated}
          autoGreet={pendingGreetingIds.has(activeConversationId ?? "")}
          onGreetingConsumed={handleGreetingConsumed}
        />
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