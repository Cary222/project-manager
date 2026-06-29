"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
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