"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconTrend } from "@/shared/ui/icons";
import { KnowledgeRecentNoteLink } from "@/app/knowledge/KnowledgeRecentNoteLink";

type NoteItem = {
  id: string;
  title: string;
  updatedAt: Date;
  project: { id: string; name: string } | null;
  user: { name: string | null; email: string };
};

type HotNoteItem = { note: NoteItem; views: number };

type NoteListData = {
  recent: NoteItem[];
  hot: HotNoteItem[];
};

type KnowledgeNoteListProps = {
  initialTab?: "latest" | "hot";
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function KnowledgeNoteList({ initialTab = "latest" }: KnowledgeNoteListProps) {
  const [data, setData] = useState<NoteListData>({ recent: [], hot: [] });
  const [tab, setTab] = useState<"latest" | "hot">(initialTab);

  useEffect(() => {
    fetch("/api/knowledge/notes")
      .then((r) => (r.ok ? (r.json() as Promise<NoteListData>) : { recent: [], hot: [] }))
      .then(setData)
      .catch(() => {});
  }, []);

  const notes = tab === "latest" ? data.recent : data.hot;

  return (
    <section className="rounded-xl border border-ink-200 bg-white shadow-soft">
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab("latest")}
            className={`rounded-md px-3 py-1 text-sm transition ${
              tab === "latest"
                ? "bg-brand-50 font-medium text-brand-600"
                : "text-ink-500 hover:bg-ink-50"
            }`}
          >
            最新
          </button>
          <button
            onClick={() => setTab("hot")}
            className={`rounded-md px-3 py-1 text-sm transition ${
              tab === "hot"
                ? "bg-brand-50 font-medium text-brand-600"
                : "text-ink-500 hover:bg-ink-50"
            }`}
          >
            热门
          </button>
        </div>
        <span className="text-xs text-ink-400">
          {tab === "hot" ? "近 30 天有效访问排行" : "按更新时间倒序"}
        </span>
      </div>

      <ul className="divide-y divide-ink-100">
        {notes.length === 0 ? (
          <li className="px-5 py-10 text-center text-sm text-ink-400">
            {tab === "hot" ? "暂无热门笔记，多看几篇再回来" : "暂无公开笔记更新"}
          </li>
        ) : tab === "latest" ? (
          (notes as NoteItem[]).map((note) => (
            <li key={note.id}>
              <KnowledgeRecentNoteLink
                note={{
                  id: note.id,
                  title: note.title,
                  project: note.project,
                  user: note.user,
                  updatedAtLabel: formatDate(note.updatedAt),
                }}
              />
            </li>
          ))
        ) : (
          (notes as HotNoteItem[]).map(({ note, views }) => (
            <li key={note.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/pkm/notes/${note.id}`}
                    className="line-clamp-1 font-medium text-ink-900 hover:text-brand-600"
                  >
                    {note.title}
                  </Link>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                    {note.project ? (
                      <span className="rounded bg-ink-100 px-1.5 py-0.5">{note.project.name}</span>
                    ) : null}
                    <span>{note.user.name ?? note.user.email}</span>
                    <span>·</span>
                    <span>{formatDate(note.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-ink-400">
                  <span>{views} 次访问</span>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
