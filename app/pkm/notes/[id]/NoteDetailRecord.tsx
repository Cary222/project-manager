"use client";

import { useEffect } from "react";
import { useRecentVisits } from "@/shared/lib/visits-context";
import type { NoteDetailProps } from "@/app/pkm/notes/[id]/page";

export function NoteDetailRecord({ note }: NoteDetailProps) {
  const { scheduleRecord } = useRecentVisits();

  useEffect(() => {
    // scheduleRecord 在停留 5 秒后才写 visits 并计次。
    // 进入页面立即写入的 recordImmediate 已在 visits-context 层合并 dedup，
    // 这里的 scheduleRecord 只负责触发 counts 增量。
    scheduleRecord({
      projectId: note.project?.id ?? "",
      projectName: note.project?.name ?? "无关联项目",
      tabKey: "note",
      tabLabel: "笔记",
      ticketId: note.id,
      ticketTitle: note.title,
    });
  }, [note.id, note.project?.id, note.project?.name, note.title, scheduleRecord]);

  return null;
}
