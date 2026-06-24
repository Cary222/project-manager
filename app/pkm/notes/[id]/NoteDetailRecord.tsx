"use client";

import { useEffect } from "react";
import { useRecentVisits } from "@/shared/lib/visits-context";
import type { NoteDetailProps } from "@/app/pkm/notes/[id]/page";

export function NoteDetailRecord(props: NoteDetailProps) {
  const { record } = useRecentVisits();

  useEffect(() => {
    record({
      projectId: props.note.project?.id ?? "",
      projectName: props.note.project?.name ?? "无关联项目",
      tabKey: "note",
      tabLabel: "笔记",
      ticketId: props.note.id,
      ticketTitle: props.note.title,
    });
  }, [props.note, record]);

  return null;
}
