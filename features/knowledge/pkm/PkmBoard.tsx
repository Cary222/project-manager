"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImageLightbox } from "@/shared/ui/ImageLightbox";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";
import { IconPkm, IconPlus, IconTag, IconTrash } from "@/shared/ui/icons";
import {
  composeImageMarkdown,
  extractInlineImages,
  normalizePkmAttachments,
  PKM_ATTACHMENT_MAX_COUNT,
  PKM_ATTACHMENT_MAX_SIZE,
  type PkmAttachment,
} from "@/shared/lib/pkm";
import { fileToDataUrl, formatBytes } from "@/shared/lib/upload";

type ProjectOption = {
  id: string;
  name: string;
};

type PkmNote = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  attachments?: PkmAttachment[] | null;
  isPublic: boolean;
  projectId: string | null;
  project: ProjectOption | null;
  createdAt: string;
  updatedAt: string;
};

type PkmBoardProps = {
  initialNotes: PkmNote[];
  projects: ProjectOption[];
  publicTagSummary: Array<[string, number]>;
  initialNoteId?: string;
};

type FlashState = {
  type: "success" | "error";
  message: string;
} | null;

const EMPTY_FORM = {
  title: "",
  content: "",
  tagsInput: "",
  projectId: "",
  isPublic: false,
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toneClass(type: "success" | "error") {
  return type === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function tagsToInput(tags: string[]) {
  return tags.join(", ");
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

function summarizeContent(content: string) {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
    .replace(/\[[^\]]+\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

export function PkmBoard({ initialNotes, projects, publicTagSummary, initialNoteId }: PkmBoardProps) {
  const [notes, setNotes] = useState(() =>
    initialNotes.map((note) => ({
      ...note,
      attachments: normalizePkmAttachments(note.attachments),
    }))
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId || initialNotes[0]?.id || null);
  const [showForm, setShowForm] = useState(initialNotes.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState(EMPTY_FORM.title);
  const [content, setContent] = useState(EMPTY_FORM.content);
  const [tagsInput, setTagsInput] = useState(EMPTY_FORM.tagsInput);
  const [projectId, setProjectId] = useState(EMPTY_FORM.projectId);
  const [isPublic, setIsPublic] = useState(EMPTY_FORM.isPublic);
  const [contentImages, setContentImages] = useState<{ src: string; name: string }[]>([]);
  const [attachments, setAttachments] = useState<PkmAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const isLightboxOpenRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashState>(null);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  useEffect(() => {
    if (initialNoteId && notes.some((note) => note.id === initialNoteId)) {
      setSelectedId(initialNoteId);
    }
  }, [initialNoteId, notes]);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId]
  );

  const tagSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [notes]);

  function resetForm() {
    setTitle(EMPTY_FORM.title);
    setContent(EMPTY_FORM.content);
    setTagsInput(EMPTY_FORM.tagsInput);
    setProjectId(EMPTY_FORM.projectId);
    setIsPublic(EMPTY_FORM.isPublic);
    setContentImages([]);
    setAttachments([]);
    setEditingId(null);
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
    setFlash(null);
  }

  function openEditForm(note: PkmNote) {
    const initialContent = extractInlineImages(note.content);
    setEditingId(note.id);
    setTitle(note.title);
    setContent(initialContent.plainContent);
    setTagsInput(tagsToInput(note.tags));
    setProjectId(note.projectId || "");
    setIsPublic(note.isPublic);
    setContentImages(initialContent.images);
    setAttachments(normalizePkmAttachments(note.attachments));
    setShowForm(true);
    setFlash(null);
    setSelectedId(note.id);
  }

  function openPreview(img: { src: string; name: string }) {
    isLightboxOpenRef.current = true;
    setPreviewImage(img);
  }

  function closePreview() {
    setPreviewImage(null);
    setTimeout(() => {
      isLightboxOpenRef.current = false;
    }, 0);
  }

  function insertImage(file: File) {
    fileToDataUrl(file).then((src) => {
      if (!src) return;
      setContentImages((prev) => [...prev, { src, name: file.name }]);
    });
  }

  function removeImage(index: number) {
    if (isLightboxOpenRef.current) return;
    setContentImages((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  function appendAttachment(file: File) {
    if (attachments.length >= PKM_ATTACHMENT_MAX_COUNT) {
      setFlash({ type: "error", message: `最多上传 ${PKM_ATTACHMENT_MAX_COUNT} 个附件` });
      return;
    }

    if (file.size > PKM_ATTACHMENT_MAX_SIZE) {
      setFlash({ type: "error", message: `附件 ${file.name} 超过 ${formatBytes(PKM_ATTACHMENT_MAX_SIZE)} 限制` });
      return;
    }

    fileToDataUrl(file).then((url) => {
      if (!url) return;

      setAttachments((prev) =>
        normalizePkmAttachments([
          ...prev,
          {
            name: file.name,
            url,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
          },
        ])
      );
    });
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSaving(true);
    setFlash(null);

    const { content: fullContent } = composeImageMarkdown(contentImages, content.trim());

    try {
      const response = await fetch(editingId ? `/api/pkm/notes/${editingId}` : "/api/pkm/notes", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: fullContent,
          tags: parseTags(tagsInput),
          projectId: projectId || null,
          isPublic,
          attachments,
        }),
      });

      const data = (await response.json()) as { error?: string; note?: PkmNote };
      if (!response.ok || !data.note) {
        throw new Error(data.error || "保存失败");
      }

      const nextNote = {
        ...data.note,
        attachments: normalizePkmAttachments(data.note.attachments),
      };

      setNotes((current) => {
        const next = editingId
          ? current.map((note) => (note.id === nextNote.id ? nextNote : note))
          : [nextNote, ...current];
        return next.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      });
      setSelectedId(nextNote.id);
      setShowForm(false);
      resetForm();
      setFlash({ type: "success", message: editingId ? "笔记已更新" : "笔记已创建" });
    } catch (error) {
      setFlash({ type: "error", message: error instanceof Error ? error.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(note: PkmNote) {
    if (!window.confirm(`确认删除笔记“${note.title}”吗？`)) return;

    setDeletingId(note.id);
    setFlash(null);

    try {
      const response = await fetch(`/api/pkm/notes/${note.id}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "删除失败");
      }

      const nextNotes = notes.filter((item) => item.id !== note.id);
      setNotes(nextNotes);
      if (selectedId === note.id) {
        setSelectedId(nextNotes[0]?.id ?? null);
      }
      if (editingId === note.id) {
        resetForm();
        setShowForm(nextNotes.length === 0);
      }
      setFlash({ type: "success", message: "笔记已删除" });
    } catch (error) {
      setFlash({ type: "error", message: error instanceof Error ? error.message : "删除失败" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {previewImage ? (
        <ImageLightbox
          image={previewImage}
          onClose={closePreview}
          onDownload={() => {
            const anchor = document.createElement("a");
            anchor.href = previewImage.src;
            anchor.download = previewImage.name || "image";
            anchor.click();
          }}
        />
      ) : null}

      <div className="space-y-5 pm-fade-in">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-ink-600">
          <div>
            <p className="font-medium text-ink-800">PKM 已接入个人笔记闭环</p>
            <p className="mt-1 text-xs text-ink-500">保存后会自动写入搜索索引与 embedding，随后可在 `/knowledge` 搜索到。</p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <IconPlus className="h-4 w-4" />
            新建笔记
          </button>
        </div>

        {flash ? <p className={`rounded-lg border px-3 py-2 text-sm ${toneClass(flash.type)}`}>{flash.message}</p> : null}

        <div className="grid items-start gap-5 lg:grid-cols-4">
          <aside className="space-y-3 self-start lg:col-span-1">
            <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
              <h2 className="mb-3 text-sm font-medium text-ink-500">概览</h2>
              <ul className="space-y-2 text-sm text-ink-600">
                <li className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-brand-700">
                  <span>全部笔记</span>
                  <span className="text-xs font-medium">{notes.length}</span>
                </li>
                <li className="flex items-center justify-between rounded-lg px-3 py-2">
                  <span>关联项目</span>
                  <span className="text-xs text-ink-400">{notes.filter((note) => note.projectId).length}</span>
                </li>
                <li className="flex items-center justify-between rounded-lg px-3 py-2">
                  <span>标签数</span>
                  <span className="text-xs text-ink-400">{tagSummary.length}</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
              <h2 className="mb-3 text-sm font-medium text-ink-500">公开热门标签</h2>
              <div className="flex flex-wrap gap-2">
                {publicTagSummary.length === 0 ? (
                  <span className="text-xs text-ink-400">暂无公开标签，先公开第一条团队笔记。</span>
                ) : (
                  publicTagSummary.map(([tag, count]) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600"
                    >
                      <IconTag className="h-3 w-3 text-ink-400" />
                      {tag}
                      <span className="text-ink-400">{count}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-4 lg:col-span-3">
            {showForm ? (
              <form
                onSubmit={handleSubmit}
                className="grid min-w-0 max-w-full gap-4 self-start rounded-xl border border-ink-200 bg-white p-5 shadow-soft"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-medium text-ink-900">{editingId ? "编辑笔记" : "新建笔记"}</h2>
                    <p className="mt-1 text-xs text-ink-400">标题、正文、标签、项目和附件名都会进入搜索索引。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                    className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-600 hover:bg-ink-100"
                  >
                    取消
                  </button>
                </div>

                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <label className="flex min-w-0 flex-col gap-2 md:col-span-2">
                    <span className="text-sm font-medium text-ink-700">标题</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="例如：Prisma + pgvector 踩坑记录"
                      className="w-full min-w-0 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    />
                  </label>

                  <label className="flex min-w-0 flex-col gap-2">
                    <span className="text-sm font-medium text-ink-700">关联项目</span>
                    <select
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      className="w-full min-w-0 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    >
                      <option value="">不关联项目</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex min-w-0 flex-col gap-2">
                    <span className="text-sm font-medium text-ink-700">标签</span>
                    <input
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="例如：RAG, Prisma, 搜索"
                      className="w-full min-w-0 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    />
                  </label>

                  <label className="md:col-span-2 flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink-700">公开到团队知识库</span>
                      <span className="mt-1 block text-xs text-ink-400">
                        公开后会出现在知识库最近更新、公共搜索和热门标签中；不公开时仅你自己可查看。
                      </span>
                    </span>
                  </label>

                  <label className="flex min-w-0 flex-col gap-2 md:col-span-2">
                    <span className="text-sm font-medium text-ink-700">正文（Markdown）</span>
                    <div className="min-w-0 rounded-lg border border-ink-200 bg-white">
                      {contentImages.length > 0 ? (
                        <div
                          className="min-w-0 flex flex-wrap gap-2 border-b border-ink-200 p-3"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
                        >
                          {contentImages.map((img, index) => (
                            <div
                              key={`${img.name}-${index}`}
                              className="group relative"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.src}
                                alt={img.name}
                                className="max-h-28 cursor-pointer rounded-lg border border-ink-200 object-contain hover:ring-2 hover:ring-brand-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPreview(img);
                                }}
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  removeImage(index);
                                }}
                                className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:!bg-danger group-hover:flex"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onPaste={(e) => {
                          const items = e.clipboardData.items;
                          for (const item of items) {
                            if (item.type.startsWith("image/")) {
                              e.preventDefault();
                              const file = item.getAsFile();
                              if (file) insertImage(file);
                              return;
                            }
                          }
                        }}
                        rows={10}
                        placeholder="记录你的方案、踩坑、结论和上下文。支持 Markdown，也支持直接粘贴截图。"
                        className="w-full min-w-0 px-3 py-2 font-mono text-sm leading-6 outline-none placeholder:text-ink-400"
                        style={{ minHeight: "180px", resize: "vertical" }}
                      />
                    </div>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <label className="w-fit cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100">
                    插入图片
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) insertImage(file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>

                  <label className="w-fit cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100">
                    上传附件
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (isImageFile(file)) {
                            insertImage(file);
                          } else {
                            appendAttachment(file);
                          }
                        }
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>

                {attachments.length > 0 ? (
                  <div className="rounded-lg border border-ink-200 bg-ink-50/70 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-ink-700">附件</p>
                      <p className="text-xs text-ink-400">最多 {PKM_ATTACHMENT_MAX_COUNT} 个，单个不超过 {formatBytes(PKM_ATTACHMENT_MAX_SIZE)}</p>
                    </div>
                    <div className="space-y-2">
                      {attachments.map((attachment, index) => (
                        <div
                          key={`${attachment.name}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2 flex-1">
                            <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-500">
                              {attachment.name.split(".").pop()?.toUpperCase() ?? "文件"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-ink-700">{attachment.name}</p>
                              <p className="text-xs text-ink-400">{attachment.mimeType} · {formatBytes(attachment.size)}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {(() => {
                              const p = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
                              const canPreview = p.includes(attachment.mimeType) || attachment.mimeType.startsWith("image/");
                              return canPreview ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewFile({ name: attachment.name, url: attachment.url, mimeType: attachment.mimeType })}
                                  className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:border-brand-300 hover:text-brand-700"
                                >
                                  预览
                                </button>
                              ) : null;
                            })()}
                            <button
                              type="button"
                              onClick={() => removeAttachment(index)}
                              className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-danger hover:bg-rose-50"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="min-w-0 rounded-lg border border-dashed border-ink-200 bg-ink-50/60 p-4">
                  <p className="text-xs font-medium text-ink-500">Markdown 预览</p>
                  <div className="mt-3 min-h-16 overflow-x-auto text-sm text-ink-600">
                    {content.trim() ? (
                      <MarkdownContent content={content} collapsible collapsedHeight={240} />
                    ) : (
                      <p className="text-sm text-ink-400">输入正文后会在这里预览。</p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving || !title.trim() || !content.trim()}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "保存中…" : editingId ? "保存修改" : "创建笔记"}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="space-y-3">
              {notes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center shadow-soft">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
                    <IconPkm className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-ink-700">还没有个人笔记</p>
                  <p className="mt-1 text-sm text-ink-400">从第一条笔记开始，让团队知识进入搜索系统。</p>
                </div>
              ) : (
                notes.map((note) => {
                  const active = note.id === selectedId;
                  const noteAttachments = normalizePkmAttachments(note.attachments);
                  return (
                    <article
                      key={note.id}
                      className={`rounded-xl border bg-white p-5 shadow-soft transition ${
                        active ? "border-brand-300 shadow-base" : "border-ink-200 hover:border-brand-200"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(note.id)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            <IconPkm className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <h3 className="truncate font-medium text-ink-900">{note.title}</h3>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    note.isPublic ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
                                  }`}
                                >
                                  {note.isPublic ? "公开" : "私有"}
                                </span>
                              </div>
                              <span className="shrink-0 text-xs text-ink-400">{formatDate(note.updatedAt)}</span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-sm text-ink-500">{summarizeContent(note.content) || "暂无正文"}</p>
                            <p className="mt-2 text-xs text-ink-400">
                              {note.project?.name || "未关联项目"}
                              {note.tags.length > 0 ? ` · ${note.tags.join(" · ")}` : ""}
                              {noteAttachments.length > 0 ? ` · 附件 ${noteAttachments.length}` : ""}
                            </p>
                          </div>
                        </button>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => openEditForm(note)}
                            className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-600 hover:bg-ink-100"
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(note)}
                            disabled={deletingId === note.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-2 text-sm text-danger hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <IconTrash className="h-4 w-4" />
                            {deletingId === note.id ? "删除中…" : "删除"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            {selectedNote ? (
              <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-medium text-ink-900">当前查看</h2>
                    <p className="mt-1 text-xs text-ink-400">{selectedNote.project?.name || "未关联项目"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        selectedNote.isPublic ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
                      }`}
                    >
                      {selectedNote.isPublic ? "公开笔记" : "私有笔记"}
                    </span>
                    <span className="text-xs text-ink-400">更新于 {formatDate(selectedNote.updatedAt)}</span>
                  </div>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink-900">{selectedNote.title}</h3>
                {selectedNote.tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedNote.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-4">
                  <MarkdownContent content={selectedNote.content} collapsible collapsedHeight={240} />
                </div>
                {normalizePkmAttachments(selectedNote.attachments).length > 0 ? (
                  <div className="mt-5 border-t border-ink-100 pt-4">
                    <h4 className="text-sm font-medium text-ink-800">附件</h4>
                    <div className="mt-3 space-y-2">
                      {normalizePkmAttachments(selectedNote.attachments).map((attachment, index) => (
                        <AttachmentItem
                          key={`${attachment.name}-${index}`}
                          attachment={attachment}
                          onPreview={setPreviewFile}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
        {previewFile && (
          <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
        )}
      </div>
    </>
  );
}
