"use client";

import Link from "next/link";
import { useRecentVisits } from "@/shared/lib/visits-context";
import { IconBook } from "@/shared/ui/icons";

type Props = {
  note: {
    id: string;
    title: string;
    project?: { id: string; name: string } | null;
    user: { name: string | null; email: string };
    updatedAtLabel: string;
  };
};

/**
 * /knowledge 页面"最近更新"列表中的笔记链接。
 *
 * 服务端渲染的 <a> 标签在跳转后才会执行目标页的 NoteDetailRecord，
 * 但因为 React 18 严格模式 / 异步 hydration 等原因偶发不触发，
 * 这里在 onClick 主动写入一次 recordImmediate 兜底。
 */
export function KnowledgeRecentNoteLink({ note }: Props) {
  const { recordImmediate } = useRecentVisits();

  const handleClick = () => {
    recordImmediate({
      projectId: note.project?.id ?? "",
      projectName: note.project?.name ?? "无关联项目",
      tabKey: "note",
      tabLabel: "笔记",
      ticketId: note.id,
      ticketTitle: note.title,
    });
  };

  return (
    <Link
      href={`/pkm/notes/${note.id}`}
      onClick={handleClick}
      className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-ink-100/50"
    >
      <IconBook className="h-4 w-4 text-ink-400" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title}</span>
      <span className="hidden text-xs text-ink-400 sm:inline">
        {note.project?.name || "未关联项目"} · {note.user.name || note.user.email}
      </span>
      <span className="shrink-0 text-xs text-ink-400">{note.updatedAtLabel}</span>
    </Link>
  );
}