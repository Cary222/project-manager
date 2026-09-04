"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconEdit,
  IconPlus,
  IconTrash,
  IconX,
  IconSearch,
  IconSparkles,
} from "@/shared/ui/icons";
import { useToast } from "@/shared/lib/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConversationCategory = "CHAT" | "WORK" | "ALL";

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  summary?: string;
  tags?: string[];
  category?: "CHAT" | "WORK";
}

interface AiConversationSidebarProps {
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onClose?: () => void;
  onCollapse?: () => void;
  onSwitchToWorkMode?: () => void;
  onNewConversation?: (category?: "CHAT" | "WORK") => void;
  /** Current category filter; pass undefined to show all */
  category?: ConversationCategory;
  onCategoryChange?: (cat: ConversationCategory) => void;
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

export function AiConversationSidebar({
  activeId,
  onSelect,
  onClose,
  onCollapse,
  onSwitchToWorkMode,
  onNewConversation,
  category = "ALL",
  onCategoryChange,
}: AiConversationSidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { toast } = useToast();

  // Context menu state: id of the conversation being acted on
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load conversations with category filter
  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        category === "ALL"
          ? "/api/ai/conversations"
          : `/api/ai/conversations?category=${category}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setConversations(json.data ?? []);
    } catch (err) {
      setError("加载失败，请重试");
      toast.error("加载失败，请重试");
      console.error("[AiConversationSidebar] load error:", err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    void (async () => {
      await loadConversations();
    })();
  }, [loadConversations]);

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

  const handleDelete = useCallback(
    async (id: string) => {
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
    },
    [activeId, onSelect]
  );

  const handleTogglePin = useCallback(
    async (convId: string) => {
      const target = conversations.find((c) => c.id === convId);
      if (!target) return;
      const currentTags = target.tags ?? [];
      const isPinned = currentTags.includes("pinned");
      const nextTags = isPinned
        ? currentTags.filter((t) => t !== "pinned")
        : [...currentTags, "pinned"];

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, tags: nextTags } : c))
      );
      setMenuOpen(null);

      try {
        const res = await fetch(`/api/ai/conversations/${convId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: nextTags }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error("[AiConversationSidebar] toggle pin error:", err);
      }
    },
    [conversations]
  );

  const handleRemoveTag = useCallback(
    async (convId: string, tagToRemove: string) => {
      const target = conversations.find((c) => c.id === convId);
      if (!target) return;
      const nextTags = (target.tags ?? []).filter((t) => t !== tagToRemove);

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, tags: nextTags } : c))
      );

      try {
        const res = await fetch(`/api/ai/conversations/${convId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: nextTags }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error("[AiConversationSidebar] remove tag error:", err);
      }
    },
    [conversations]
  );

  const startRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameValue(currentTitle);
    setMenuOpen(null);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  // Filtered & grouped conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [conversations, searchQuery]);

  const pinnedList = useMemo(
    () => filteredConversations.filter((c) => c.tags?.includes("pinned")),
    [filteredConversations]
  );

  const recentList = useMemo(
    () => filteredConversations.filter((c) => !c.tags?.includes("pinned")),
    [filteredConversations]
  );

  const categoryTabs: { value: ConversationCategory; label: string }[] = [
    { value: "ALL", label: "全部" },
    { value: "CHAT", label: "对话" },
    { value: "WORK", label: "工作" },
  ];

  const renderConversationItem = (conv: ConversationSummary) => {
    const isActive = conv.id === activeId;
    const isRenaming = conv.id === renamingId;
    const isDeleting = conv.id === deletingId;
    const isPinned = conv.tags?.includes("pinned");

    return (
      <div
        key={conv.id}
        className={`group relative mx-2 my-0.5 flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 transition select-none ${
          isActive
            ? "border-l-4 border-brand-500 bg-brand-50/80 text-brand-900 font-medium pl-1.5"
            : "border-l-4 border-transparent hover:bg-ink-100/70 text-ink-700"
        }`}
        onClick={() => !isRenaming && !isDeleting && onSelect(conv.id)}
      >
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
              className="w-full rounded border border-brand-300 bg-white px-2 py-0.5 text-xs text-ink-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-100"
            />
          ) : (
            <p className="truncate text-xs leading-snug">
              {conv.title || "未命名会话"}
            </p>
          )}

          {/* Tags */}
          {conv.tags && conv.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {conv.tags
                .filter((t) => t !== "pinned")
                .map((tag) => (
                  <span
                    key={tag}
                    className="group/tag inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[9px] font-medium text-brand-700"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemoveTag(conv.id, tag);
                      }}
                      className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full text-brand-400 opacity-0 transition hover:bg-brand-200 hover:text-danger group-hover/tag:opacity-100"
                      aria-label={`删除标签 ${tag}`}
                      title={`删除标签 ${tag}`}
                    >
                      <IconX className="h-2 w-2" />
                    </button>
                  </span>
                ))}
            </div>
          )}

          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-400">
            <span>{formatRelativeTime(conv.lastMessageAt)}</span>
            <span>·</span>
            <span>{conv.messageCount} 条</span>
            {conv.category === "WORK" && (
              <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-medium text-amber-700">
                工作
              </span>
            )}
          </div>
        </div>

        {/* Context menu trigger */}
        {!isRenaming && !isDeleting && (
          <div className="opacity-0 group-hover:opacity-100 transition shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(menuOpen === conv.id ? null : conv.id);
              }}
              className="rounded-lg p-1 text-ink-400 hover:bg-ink-200 hover:text-ink-600 transition"
              title="操作"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          </div>
        )}

        {/* Dropdown menu */}
        {menuOpen === conv.id && !isRenaming && !isDeleting && (
          <div className="absolute right-2 top-7 z-30 w-28 rounded-xl border border-ink-200 bg-white py-1 shadow-elevated">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleTogglePin(conv.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
            >
              <span>📌</span>
              {isPinned ? "取消置顶" : "置顶会话"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startRename(conv.id, conv.title);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-danger transition hover:bg-red-50"
            >
              <IconTrash className="h-3 w-3" />
              删除
            </button>
          </div>
        )}

        {/* Delete confirm */}
        {isDeleting && (
          <div
            className="absolute right-2 top-7 z-30"
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
  };

  return (
    <aside
      ref={menuRef}
      className="flex h-full w-full flex-col bg-white select-none"
    >
      {/* Top Header: Logo + Search + Collapse Button (ChatGPT style) */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-100 px-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-2xs">
            <IconSparkles className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold text-ink-800 tracking-tight">
            小星 AI
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Search Toggle */}
          <button
            type="button"
            onClick={() => setIsSearchOpen((prev) => !prev)}
            className={`rounded-lg p-1.5 transition ${
              isSearchOpen
                ? "bg-ink-100 text-ink-800"
                : "text-ink-400 hover:bg-ink-100 hover:text-ink-600"
            }`}
            title="搜索对话"
            aria-label="搜索对话"
          >
            <IconSearch className="h-3.5 w-3.5" />
          </button>

          {/* Collapse sidebar button */}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition"
              title="收起侧边栏"
              aria-label="收起侧边栏"
            >
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
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          )}

          {/* Close drawer (on mobile) */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition md:hidden"
              title="关闭"
            >
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Prominent Action: + New Chat Button (ChatGPT style) */}
      <div className="p-3 pb-2">
        <button
          type="button"
          onClick={() => {
            if (onNewConversation) {
              onNewConversation(category === "WORK" ? "WORK" : "CHAT");
            } else {
              onSelect(null);
            }
          }}
          className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs font-medium text-ink-800 shadow-2xs hover:bg-ink-50 hover:border-ink-300 transition-all group"
        >
          <div className="flex items-center gap-2">
            <IconPlus className="h-3.5 w-3.5 text-ink-500 group-hover:text-brand-600 transition" />
            <span>新建对话</span>
          </div>
          <span className="text-[10px] text-ink-400 font-mono">New</span>
        </button>

        {/* Expandable Search Input */}
        {isSearchOpen && (
          <div className="mt-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索历史对话..."
              autoFocus
              className="w-full rounded-lg border border-ink-200 bg-ink-50/50 px-2.5 py-1 text-xs text-ink-900 placeholder:text-ink-400 focus:bg-white focus:border-brand-500 focus:outline-none"
            />
          </div>
        )}

        {/* Category Tabs */}
        {onCategoryChange && (
          <div className="mt-2.5 flex gap-1 rounded-lg bg-ink-100/70 p-0.5">
            {categoryTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => onCategoryChange(tab.value)}
                className={`flex-1 rounded-md py-1 text-center text-xs font-medium transition-all ${
                  category === tab.value
                    ? "bg-white text-ink-900 shadow-2xs"
                    : "text-ink-500 hover:text-ink-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {loading ? (
          <div className="space-y-1">
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </div>
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
        ) : filteredConversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-xs text-ink-400">
              {searchQuery ? "未找到匹配会话" : "还没有对话"}
            </p>
            {!searchQuery && (
              <p className="mt-1 text-[11px] text-ink-300">点击上方新建对话</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Pinned Section */}
            {pinnedList.length > 0 && (
              <div>
                <div className="px-3 py-1 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">
                  置顶
                </div>
                <div className="space-y-0.5">
                  {pinnedList.map(renderConversationItem)}
                </div>
              </div>
            )}

            {/* Recents Section */}
            <div>
              {pinnedList.length > 0 && (
                <div className="px-3 py-1 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">
                  最近
                </div>
              )}
              <div className="space-y-0.5">
                {recentList.map(renderConversationItem)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer / Switch to Work Mode Button */}
      {onSwitchToWorkMode && (
        <div className="border-t border-ink-100 p-2.5">
          <button
            type="button"
            onClick={onSwitchToWorkMode}
            className="flex w-full items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs font-medium text-brand-700 transition hover:bg-brand-100/80 hover:text-brand-800"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-600 text-white">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </span>
              <span>进入 Work 模式</span>
            </div>
            <span className="text-brand-400">→</span>
          </button>
        </div>
      )}
    </aside>
  );
}
