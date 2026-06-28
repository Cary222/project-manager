"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconEdit, IconPlus, IconTrash, IconX } from "@/shared/ui/icons";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  summary?: string;
}

interface AiConversationSidebarProps {
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onClose?: () => void;
  // Optional handler for the "新对话" button. When provided, the button
  // creates a new conversation via the parent instead of just calling
  // onSelect(null). The parent uses this to also trigger the AI greeting.
  onNewConversation?: () => void;
}

// ─── Time formatting ──────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "昨天";
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}个月前`;
  return `${Math.floor(months / 12)}年前`;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonItem() {
  return (
    <div className="flex items-start gap-3 rounded-xl p-3">
      <div className="mt-1 h-4 w-4 shrink-0 animate-pulse rounded bg-ink-200" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-ink-200" />
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-12 animate-pulse rounded-full bg-ink-100" />
          <div className="h-2.5 w-16 animate-pulse rounded bg-ink-100" />
        </div>
      </div>
    </div>
  );
}

// ─── Inline Confirm ───────────────────────────────────────────────────────────

function InlineConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-elevated">
      <p className="mb-2.5 text-xs font-medium text-ink-700">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-lg bg-danger px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-red-600"
        >
          确认
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function AiConversationSidebar({ activeId, onSelect, onClose, onNewConversation }: AiConversationSidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Context menu state: id of the conversation being acted on
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/conversations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setConversations(json.data ?? []);
    } catch (err) {
      setError("加载失败，请重试");
      console.error("[AiConversationSidebar] load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void (async () => { await loadConversations(); })(); }, [loadConversations]);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Focus rename input when rename starts
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleRename = useCallback(async () => {
    const id = renamingId;
    const title = renameValue.trim();
    if (!id || !title) {
      setRenamingId(null);
      return;
    }
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    } catch (err) {
      console.error("[AiConversationSidebar] rename error:", err);
    } finally {
      setRenamingId(null);
    }
  }, [renamingId, renameValue]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) onSelect(null);
    } catch (err) {
      console.error("[AiConversationSidebar] delete error:", err);
    } finally {
      setDeletingId(null);
      setMenuOpen(null);
    }
  }, [activeId, onSelect]);

  const startRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
    setMenuOpen(null);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <aside
      ref={menuRef}
      className="flex w-[260px] shrink-0 flex-col border-r border-ink-200 bg-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3.5">
        <span className="text-sm font-semibold text-ink-700">对话历史</span>
        <div className="flex items-center gap-1">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
              title="关闭"
            >
              <IconX className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (onNewConversation) {
                onNewConversation();
              } else {
                onSelect(null);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700"
          >
            <IconPlus className="h-3.5 w-3.5" />
            新对话
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <>
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-danger">{error}</p>
            <button
              type="button"
              onClick={loadConversations}
              className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              重试
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-ink-400">还没有对话</p>
            <p className="mt-1 text-xs text-ink-300">开始一个吧</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeId;
            const isRenaming = conv.id === renamingId;
            const isDeleting = conv.id === deletingId;

            return (
              <div
                key={conv.id}
                className={`group relative mx-2 my-0.5 flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition ${
                  isActive
                    ? "border-l-4 border-brand-500 bg-brand-50 pl-2"
                    : "border-l-4 border-transparent hover:bg-ink-50"
                }`}
                onClick={() => !isRenaming && !isDeleting && onSelect(conv.id)}
              >
                {/* Content */}
                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      onBlur={handleRename}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-brand-300 bg-white px-2 py-1 text-xs text-ink-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-100"
                    />
                  ) : (
                    <p
                      className={`truncate text-xs font-medium leading-snug ${
                        isActive ? "text-brand-700" : "text-ink-700"
                      }`}
                    >
                      {conv.title.length > 20
                        ? conv.title.slice(0, 20) + "…"
                        : conv.title}
                    </p>
                  )}

                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-ink-400">
                      {formatRelativeTime(conv.lastMessageAt)}
                    </span>
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink-100 px-1 text-[9px] font-medium text-ink-500">
                      {conv.messageCount}
                    </span>
                  </div>
                </div>

                {/* Context menu trigger */}
                {!isRenaming && !isDeleting && (
                  <div className="opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(menuOpen === conv.id ? null : conv.id);
                      }}
                      className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-200 hover:text-ink-600"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <circle cx="5" cy="12" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="19" cy="12" r="2" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Dropdown menu */}
                {menuOpen === conv.id && !isRenaming && !isDeleting && (
                  <div className="absolute right-2 top-8 z-20 w-28 rounded-xl border border-ink-200 bg-white py-1 shadow-elevated">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(conv.id, conv.title);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
                    >
                      <IconEdit className="h-3 w-3 text-ink-400" />
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(conv.id);
                        setMenuOpen(null);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-danger transition hover:bg-red-50"
                    >
                      <IconTrash className="h-3 w-3" />
                      删除
                    </button>
                  </div>
                )}

                {/* Delete confirm */}
                {isDeleting && (
                  <div
                    className="absolute right-2 top-8 z-20"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <InlineConfirmDialog
                      message="删除此对话？"
                      onConfirm={() => handleDelete(conv.id)}
                      onCancel={() => setDeletingId(null)}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
