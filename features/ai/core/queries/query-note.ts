import { prisma } from "@/shared/db/client";
import type {
  SourceReference,
  StructuredResult,
} from "@/features/ai/types/structured";

export interface NoteQueryInput {
  id?: string;
  filters?: {
    title?: string;
    userId?: string;
    projectId?: string;
    activityWindow?: "today" | "yesterday" | "this_week" | "this_month" | "recent";
  };
  limit?: number;
}

type NoteSourceReference = Omit<SourceReference, "type"> & { type: "note" };

type NoteResult = Omit<StructuredResult, "sources"> & {
  sources: NoteSourceReference[];
};

const noteSelect = {
  id: true,
  title: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true, email: true } },
  project: { select: { name: true } },
} as const;

function getWindowStart(window: NonNullable<NoteQueryInput["filters"]>["activityWindow"]): Date {
  const now = new Date();

  switch (window) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "yesterday":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    case "this_week": {
      const day = now.getDay() || 7;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    }
    case "this_month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "recent":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    default:
      return now;
  }
}

function noteSource(note: { id: string; title: string }, index: number): NoteSourceReference {
  return {
    index,
    title: note.title,
    url: `/pkm/notes/${note.id}`,
    type: "note",
  };
}

function toStructuredResult(result: NoteResult): StructuredResult {
  return result as unknown as StructuredResult;
}

export async function queryNoteById(id: string): Promise<StructuredResult> {
  const note = await prisma.pkmNote.findUnique({
    where: { id },
    select: noteSelect,
  });

  if (!note) {
    return { summary: `未找到笔记：${id}`, sources: [] };
  }

  return toStructuredResult({
    summary: [
      `笔记标题：${note.title}`,
      `作者：${note.user.name ?? note.user.email}`,
      `项目：${note.project?.name ?? "无"}`,
      `创建时间：${note.createdAt.toLocaleString("zh-CN")}`,
      `更新时间：${note.updatedAt.toLocaleString("zh-CN")}`,
      `标签：${note.tags.length > 0 ? note.tags.join("、") : "无"}`,
      `链接：/pkm/notes/${note.id}`,
    ].join("\n"),
    sources: [noteSource(note, 1)],
  });
}

export async function queryNoteByTitle(
  query: string,
  limit = 10,
): Promise<StructuredResult> {
  const title = query.trim();
  if (!title) return { summary: "请输入笔记标题", sources: [] };

  return queryNote({ filters: { title }, limit });
}

export async function queryNoteByProject(
  projectId: string,
  limit = 10,
): Promise<StructuredResult> {
  return queryNote({ filters: { projectId }, limit });
}

export async function queryNote(
  input: NoteQueryInput,
  _viewerUserId?: string,
): Promise<StructuredResult> {
  if (input.id) return queryNoteById(input.id);

  const where: {
    title?: { contains: string; mode: "insensitive" };
    userId?: string;
    projectId?: string;
    updatedAt?: { gte: Date };
  } = {};

  if (input.filters?.title?.trim()) {
    where.title = { contains: input.filters.title.trim(), mode: "insensitive" };
  }
  if (input.filters?.userId) where.userId = input.filters.userId;
  if (input.filters?.projectId) where.projectId = input.filters.projectId;
  if (input.filters?.activityWindow) {
    where.updatedAt = { gte: getWindowStart(input.filters.activityWindow) };
  }

  const notes = await prisma.pkmNote.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: input.limit ?? 10,
    select: noteSelect,
  });

  if (notes.length === 0) {
    return { summary: "未找到符合条件的笔记", sources: [] };
  }

  const lines = [`找到 ${notes.length} 条笔记：`];
  const sources = notes.map((note, index) => {
    lines.push(
      `${index + 1}. ${note.title}｜作者: ${note.user.name ?? note.user.email}｜项目: ${note.project?.name ?? "无项目"}｜更新于 ${note.updatedAt.toLocaleDateString("zh-CN")} → /pkm/notes/${note.id}`,
    );
    return noteSource(note, index + 1);
  });

  return toStructuredResult({ summary: lines.join("\n"), sources });
}
