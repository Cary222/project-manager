"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { IconTrash } from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { uploadFile, toAbsoluteUploadUrl } from "@/features/knowledge/lib/upload";
import type { CommentItem } from "@/entities/ticket/model/types";
import type { FileAttachment } from "@/features/knowledge/lib/pkm";

function IconEmoji(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="0.5" fill="currentColor" />
      <circle cx="15" cy="10" r="0.5" fill="currentColor" />
      <path d="M8 14c1.2 1.5 2.5 2 4 2s2.8-.5 4-2" />
    </svg>
  );
}

function IconImage(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21,15 16,10 5,21" />
    </svg>
  );
}

function IconFile(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  );
}

type CommentUser = {
  id: string;
  name: string | null;
  email: string;
};

type CommentsResponse = { comments: CommentItem[] };

type MentionableUser = {
  id: string;
  name: string | null;
  email: string;
};

type Props = {
  ticketId: string;
  ticketNumericId: string;
};

const MENTION_TRIGGER = "@";
const MAX_CONTENT = 5000;
const EMOJIS = [
  "👍", "👎", "✅", "❌", "🚀", "🐛", "🎉", "🤔",
  "👀", "🔥", "💡", "📌", "✏️", "🛠️", "⏰", "🙏",
];

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function avatarInitial(name: string | null, email: string): string {
  return ((name || email || "U").trim().charAt(0) || "U").toUpperCase();
}

export function TicketCommentsPanel({ ticketId, ticketNumericId }: Props) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? "";

  const { data, isLoading, mutate } = useSWR<CommentsResponse>(
    `/api/tickets/${ticketId}/comments`,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  const comments: CommentItem[] = useMemo(() => data?.comments ?? [], [data]);
  const commentsSortedAsc = useMemo(
    () => [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [comments],
  );

  // ── Editor state ──────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 图片/文件插入后形成的草稿附件列表（PR10: FileAttachment 格式，走 uploadFile)
  const [draftAttachments, setDraftAttachments] = useState<FileAttachment[]>([]);
  // 用于触发文件选择
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention popup state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);

  // Emoji popup state
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiContainerRef = useRef<HTMLDivElement>(null);

  // Click outside closes emoji popup
  useEffect(() => {
    if (!emojiOpen) return;
    function onDocClick(e: MouseEvent) {
      if (
        emojiContainerRef.current &&
        e.target instanceof Node &&
        !emojiContainerRef.current.contains(e.target)
      ) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [emojiOpen]);

  const { data: mentionUsersData } = useSWR<{ users: MentionableUser[] }>(
    mentionOpen ? "/api/users" : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );
  const mentionableUsers: MentionableUser[] = useMemo(
    () => mentionUsersData?.users ?? [],
    [mentionUsersData],
  );

  const filteredMentionable = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.trim().toLowerCase();
    return mentionableUsers
      .filter((u) => u.id !== currentUserId)
      .filter((u) => {
        if (!q) return true;
        return (u.name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [mentionOpen, mentionQuery, mentionableUsers, currentUserId]);

  // ── Mention handling ──────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart ?? 0;
    const textBefore = draft.slice(0, cursorPos);
    const lastAt = textBefore.lastIndexOf(MENTION_TRIGGER);
    if (lastAt < 0) {
      setMentionOpen(false);
      setMentionStartIndex(null);
      return;
    }
    const segment = textBefore.slice(lastAt + 1);
    if (/\s/.test(segment)) {
      setMentionOpen(false);
      setMentionStartIndex(null);
      return;
    }
    setMentionOpen(true);
    setMentionStartIndex(lastAt);
    setMentionQuery(segment);
  }, [draft]);

  function insertMention(user: MentionableUser) {
    if (mentionStartIndex === null) return;
    const before = draft.slice(0, mentionStartIndex);
    const after = draft.slice(textareaRef.current?.selectionStart ?? mentionStartIndex + 1 + mentionQuery.length);
    const displayName = user.name || user.email.split("@")[0];
    const insertion = `@[${displayName}](${user.email}) `;
    const next = before + insertion + after;
    setDraft(next);
    setMentionOpen(false);
    setMentionStartIndex(null);
    setMentionQuery("");
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        const pos = before.length + insertion.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  // ── File attachment (PR10) ───────────────────────────────────────
  async function appendAttachment(file: File) {
    setErrorMsg(null);
    try {
      const result = await uploadFile(file);
      const attachment: FileAttachment = {
        fileId: result.fileId,
        name: result.name,
        mimeType: result.mimeType,
        size: result.size,
      };
      setDraftAttachments((prev) => [...prev, attachment]);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "上传失败");
    }
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSubmit() {
    setErrorMsg(null);
    const content = draft.trim();
    if (content.length === 0) {
      setErrorMsg("备注不能为空");
      return;
    }
    if (content.length > MAX_CONTENT) {
      setErrorMsg(`备注内容不能超过 ${MAX_CONTENT} 字符`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tickets/${ticketNumericId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content,
          attachments: draftAttachments,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setDraft("");
      setDraftAttachments([]);
      await mutate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "发布失败");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────
  async function handleDelete(commentId: string) {
    if (!confirm("确定要删除这条备注吗?")) return;
    try {
      const res = await fetch(`/api/tickets/${ticketNumericId}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        alert(body.error || `删除失败 HTTP ${res.status}`);
        return;
      }
      await mutate();
    } catch {
      alert("删除失败,请重试");
    }
  }

  const isRoot = session?.user?.role === "ROOT";

  // 合并所有评论里出现过的 mention 用户，构建 email → {id, name} 映射
  // 用于 MarkdownContent 把 `@[name](email)` 渲染成跳转到 `/team/<id>` 的链接
  const mentionMap = useMemo<Record<string, { id: string; name: string }>>(() => {
    const map: Record<string, { id: string; name: string }> = {};
    for (const c of commentsSortedAsc) {
      if (!c.mentionedUsers) continue;
      for (const u of c.mentionedUsers) {
        const email = u.email.trim().toLowerCase();
        if (email) map[email] = { id: u.id, name: u.name || u.email };
      }
    }
    return map;
  }, [commentsSortedAsc]);

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <h2 className="mb-3 flex items-center gap-1.5 font-medium">
        <IconEmoji className="h-4 w-4 text-ink-400" />
        备注 / 讨论
      </h2>

      {/* 评论列表 */}
      <div className="mb-4 max-h-[420px] space-y-3 overflow-y-auto">
        {isLoading ? (
          <p className="text-xs text-ink-400">加载备注中...</p>
        ) : commentsSortedAsc.length === 0 ? (
          <p className="text-xs text-ink-400">暂无备注,留下第一条想法吧。</p>
        ) : (
          commentsSortedAsc.map((c) => {
            const canDelete = isRoot || c.authorId === currentUserId;
            return (
              <div key={c.id} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                  {avatarInitial(c.author.name, c.author.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-ink-500">
                      <Link
                        href={`/team/${c.author.id}`}
                        className="font-medium text-ink-700 hover:text-brand-600 hover:underline"
                      >
                        {c.author.name || c.author.email}
                      </Link>
                      <span>{formatTimeAgo(new Date(c.createdAt))}</span>
                    </div>
                    <MarkdownContent content={c.content} mentionMap={mentionMap} />
                    {/* PR10 F5: 评论附件列表 */}
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.attachments.map((att, idx) => {
                          const url = `/api/upload/${att.fileId}`;
                          const isImage = att.mimeType?.startsWith("image/");
                          return isImage ? (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={url}
                                alt={att.name || att.fileId}
                                className="max-h-16 rounded border border-ink-200 object-contain hover:opacity-80"
                              />
                            </a>
                          ) : (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] text-ink-600 hover:bg-ink-100"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" />
                              </svg>
                              {att.name || att.fileId.slice(0, 12)}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-danger"
                    >
                      <IconTrash className="h-3 w-3" /> 删除
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 草稿附件列表预览 */}
      {draftAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 border-t border-ink-100 pt-2">
          {draftAttachments.map((att, i) => (
            <div key={i} className="group relative flex items-center gap-1.5 rounded border border-ink-200 bg-ink-50 px-2 py-1 text-xs text-ink-700">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" />
              </svg>
              <span className="truncate max-w-[120px]" title={att.name}>{att.name || att.fileId.slice(0, 8)}</span>
              <button
                type="button"
                onClick={() => setDraftAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-ink-300 text-white hover:bg-danger"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 编辑器 */}
      <div className="relative rounded-lg border border-ink-200 bg-white">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="写一条备注...使用 @ 提及团队成员,支持 Markdown。"
          rows={3}
          maxLength={MAX_CONTENT}
          className="w-full resize-y rounded-lg bg-transparent px-3 pt-2 font-mono text-sm outline-none placeholder:text-ink-400"
          style={{ minHeight: "84px" }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        {/* Mention popup */}
        {mentionOpen && filteredMentionable.length > 0 && (
          <div className="absolute bottom-full left-2 z-30 mb-1 max-h-60 w-72 overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
          {filteredMentionable.map((u) => {
            const displayName = u.name || u.email.split("@")[0];
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => insertMention({ ...u, name: displayName })}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                  {avatarInitial(u.name, u.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink-900">
                    {displayName} · <span className="text-ink-400">{u.email}</span>
                  </span>
                </span>
              </button>
            );
          })}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-2 py-1.5">
          <div className="flex items-center gap-1">
            {/* 上传文档类附件（排除图片） */}
            <button
              type="button"
              title="上传附件"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700"
            >
              <IconFile className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.md,.txt,.csv,.zip,.rar,.7z,.gz"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (!files) return;
                for (const file of Array.from(files)) appendAttachment(file);
                e.currentTarget.value = "";
              }}
            />
            {/* 上传图片（作为评论附件） */}
            <button
              type="button"
              title="上传图片"
              onClick={() => imageInputRef.current?.click()}
              className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700"
            >
              <IconImage className="h-4 w-4" />
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (!files) return;
                for (const file of Array.from(files)) appendAttachment(file);
                e.currentTarget.value = "";
              }}
            />
            {/* Emoji */}
            <div ref={emojiContainerRef} className="relative">
              <button
                type="button"
                title="表情"
                onClick={() => setEmojiOpen((v) => !v)}
                className={`rounded-md p-1.5 hover:bg-ink-100 hover:text-ink-700 ${emojiOpen ? "bg-ink-100 text-ink-700" : "text-ink-500"}`}
              >
                <IconEmoji className="h-4 w-4" />
              </button>
              {emojiOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-1 w-56 rounded-lg border border-ink-200 bg-white p-2 shadow-lg">
                  <div className="grid grid-cols-8 gap-1">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          const ta = textareaRef.current;
                          const cursor = ta?.selectionStart ?? draft.length;
                          const next = draft.slice(0, cursor) + e + draft.slice(cursor);
                          setDraft(next);
                          requestAnimationFrame(() => {
                            if (ta) {
                              const pos = cursor + e.length;
                              ta.focus();
                              ta.setSelectionRange(pos, pos);
                            }
                          });
                          setEmojiOpen(false);
                        }}
                        className="rounded p-1 text-base hover:bg-ink-100"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {errorMsg && <span className="text-[11px] text-danger">{errorMsg}</span>}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || draft.trim().length === 0}
              className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:bg-ink-300"
            >
              {submitting ? "发布中..." : "发布"}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-ink-400">⌘/Ctrl + Enter 快速发布 · @ 提及成员会发送通知</p>
    </section>
  );
}
