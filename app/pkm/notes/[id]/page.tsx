import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MarkdownContent } from "@/components/common/MarkdownContent";
import { IconArrowRight, IconKnowledge, IconTag } from "@/components/common/icons";
import { prisma } from "@/lib/db";
import { normalizePkmAttachments } from "@/lib/pkm";
import { requireSession } from "@/lib/permissions";

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
              {note.tags.map((tag) => (
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

          {attachments.length > 0 ? (
            <div className="mt-6 border-t border-ink-100 pt-4">
              <h2 className="text-sm font-medium text-ink-800">附件</h2>
              <div className="mt-3 space-y-2">
                {attachments.map((attachment, index) => (
                  <a
                    key={`${attachment.name}-${index}`}
                    href={attachment.url}
                    download={attachment.name}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-700">{attachment.name}</p>
                      <p className="text-xs text-ink-400">{attachment.mimeType} · {attachment.size} B</p>
                    </div>
                    <span className="shrink-0 text-xs text-brand-600">下载</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-ink-600">
          <IconKnowledge className="h-4 w-4 text-brand-600" />
          <span>{note.isPublic ? "这条笔记已同步到团队知识库搜索。" : "这条笔记仅你自己可见，不会出现在公共知识库。"}</span>
        </section>
      </div>
    </AppShell>
  );
}
