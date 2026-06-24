import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/shared/ui/AppShell";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { IconArrowRight, IconKnowledge, IconTag } from "@/shared/ui/icons";
import { prisma } from "@/shared/db/client";
import { normalizePkmAttachments } from "@/shared/lib/pkm";
import { requireSession } from "@/shared/lib/permissions";
import { NoteAttachments } from "@/shared/ui/NoteAttachments";
import { NoteDetailRecord } from "./NoteDetailRecord";

export type NoteDetailProps = {
  note: {
    id: string;
    title: string;
    project: { id: string | null; name: string | null };
  };
};

type Params = { params: Promise<{ id: string }> };

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default async function PkmNoteDetailPage({ params }: Params) {
  const session = await requireSession();
  const { id } = await params;

  const note = await prisma.pkmNote.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  });

  if (!note) {
    notFound();
  }

  const isOwner = note.userId === session.user.id;
  if (!note.isPublic && !isOwner) {
    notFound();
  }

  const authorName = note.user.name || note.user.email;
  const attachments = normalizePkmAttachments(note.attachments);

  return (
    <AppShell
      header={
        <div>
          <div className="flex items-center gap-2 text-xs text-ink-400">
            <Link href="/knowledge" className="hover:text-brand-600">
              知识库
            </Link>
            <IconArrowRight className="h-3.5 w-3.5" />
            <span>笔记详情</span>
          </div>
          <h1 className="mt-2 text-lg font-semibold leading-tight">{note.title}</h1>
          <p className="text-xs text-ink-400">{note.isPublic ? "公开笔记" : "私有笔记"} · {authorName}</p>
        </div>
      }
    >
      <NoteDetailRecord note={note} />
      <div className="space-y-5 pm-fade-in">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <span className={`rounded-full px-2.5 py-1 font-medium ${note.isPublic ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-600"}`}>
              {note.isPublic ? "公开" : "私有"}
            </span>
            <span>{authorName}</span>
            <span>·</span>
            <span>{note.project?.name || "未关联项目"}</span>
            <span>·</span>
            <span>更新于 {formatDate(note.updatedAt)}</span>
          </div>

          {note.tags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {note.tags.map((tag: string) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600">
                  <IconTag className="h-3 w-3 text-ink-400" />
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-5 min-w-0">
            <MarkdownContent content={note.content} collapsible collapsedHeight={360} />
          </div>

          <NoteAttachments attachments={attachments} />
        </section>

        <section className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-ink-600">
          <IconKnowledge className="h-4 w-4 text-brand-600" />
          <span>{note.isPublic ? "这条笔记已同步到团队知识库搜索。" : "这条笔记仅你自己可见，不会出现在公共知识库。"}</span>
        </section>
      </div>
    </AppShell>
  );
}
