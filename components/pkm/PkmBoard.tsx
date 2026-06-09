"use client";

import { useEffect, useMemo, useState } from "react";
import { IconPkm, IconPlus, IconTag, IconTrash } from "@/components/icons";

type ProjectOption = {
  id: string;
  name: string;
};

type PkmNote = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  projectId: string | null;
  project: ProjectOption | null;
  createdAt: string;
  updatedAt: string;
};

type PkmBoardProps = {
  initialNotes: PkmNote[];
  projects: ProjectOption[];
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

export function PkmBoard({ initialNotes, projects, initialNoteId }: PkmBoardProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId || initialNotes[0]?.id || null);
  const [showForm, setShowForm] = useState(initialNotes.length === 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState(EMPTY_FORM.title);
  const [content, setContent] = useState(EMPTY_FORM.content);
  const [tagsInput, setTagsInput] = useState(EMPTY_FORM.tagsInput);
  const [projectId, setProjectId] = useState(EMPTY_FORM.projectId);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashState>(null);

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
    setEditingId(null);
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
    setFlash(null);
  }

  function openEditForm(note: PkmNote) {
    setEditingId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setTagsInput(tagsToInput(note.tags));
    setProjectId(note.projectId || "");
    setShowForm(true);
    setFlash(null);
    setSelectedId(note.id);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setSaving(true);
    setFlash(null);

    try {
      const response = await fetch(editingId ? `/api/pkm/notes/${editingId}` : "/api/pkm/notes", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          tags: parseTags(tagsInput),
          projectId: projectId || null,
        }),
      });

      const data = (await response.json()) as { error?: string; note?: PkmNote };
      if (!response.ok || !data.note) {
        throw new Error(data.error || "保存失败");
      }

      setNotes((current) => {
        const next = editingId
          ? current.map((note) => (note.id === data.note?.id ? data.note : note))
          : [data.note!, ...current];
        return next.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      });
      setSelectedId(data.note.id);
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

      <div className="grid gap-5 lg:grid-cols-4">
        <aside className="space-y-3 lg:col-span-1">
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
            <h2 className="mb-3 text-sm font-medium text-ink-500">热门标签</h2>
            <div className="flex flex-wrap gap-2">
              {tagSummary.length === 0 ? (
                <span className="text-xs text-ink-400">还没有标签，先写第一条笔记。</span>
              ) : (
                tagSummary.map(([tag, count]) => (
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

        <div className="space-y-4 lg:col-span-3">
          {showForm ? (
            <form onSubmit={handleSubmit} className="grid gap-4 rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium text-ink-900">{editingId ? "编辑笔记" : "新建笔记"}</h2>
                  <p className="mt-1 text-xs text-ink-400">标题、正文、标签和项目都会进入搜索索引。</p>
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

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-ink-700">标题</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="例如：Prisma + pgvector 踩坑记录"
                    className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink-700">关联项目</span>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="">不关联项目</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink-700">标签</span>
                  <input
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="例如：RAG, Prisma, 搜索"
                    className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </label>

                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-ink-700">正文</span>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={8}
                    placeholder="记录你的方案、踩坑、结论和上下文。"
                    className="rounded-lg border border-ink-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </label>
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
                            <h3 className="truncate font-medium text-ink-900">{note.title}</h3>
                            <span className="shrink-0 text-xs text-ink-400">{formatDate(note.updatedAt)}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-sm text-ink-500">{note.content}</p>
                          <p className="mt-2 text-xs text-ink-400">
                            {note.project?.name || "未关联项目"}
                            {note.tags.length > 0 ? ` · ${note.tags.join(" · ")}` : ""}
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
                <span className="text-xs text-ink-400">更新于 {formatDate(selectedNote.updatedAt)}</span>
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
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-ink-600">{selectedNote.content}</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
