import { AppShell } from "@/components/AppShell";
import { IconBook, IconTag } from "@/components/icons";
import { KnowledgeSearchPanel } from "@/components/search/KnowledgeSearchPanel";
import { prisma } from "@/lib/db";

const SPACES = [
  { name: "光伏云平台", docs: 42, color: "bg-brand-50 text-brand-600" },
  { name: "物联网网关服务", docs: 28, color: "bg-emerald-50 text-emerald-600" },
  { name: "内部运营系统", docs: 19, color: "bg-amber-50 text-warning" },
  { name: "通用研发规范", docs: 35, color: "bg-violet-50 text-purple" },
];

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const initialQuery = params?.q ?? "";
  const showSearchResults = initialQuery.trim().length > 0;

  const [recentNotes, publicTagSummary] = await Promise.all([
    prisma.pkmNote.findMany({
      where: { isPublic: true },
      include: {
        user: { select: { name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.pkmNote.findMany({
      where: { isPublic: true },
      select: { tags: true },
    }).then((notes) => {
      const counts = new Map<string, number>();
      for (const note of notes) {
        for (const tag of note.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 12);
    }),
  ]);

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">知识库</h1>
          <p className="text-xs text-ink-400">Knowledge Base · 团队文档与规范沉淀</p>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">已接入</span>
          知识库当前结果来自工单、提交记录与个人笔记。
        </div>

        <KnowledgeSearchPanel initialQuery={initialQuery} />

        {!showSearchResults ? (
          <>
            <section>
              <h2 className="mb-3 text-sm font-medium text-ink-500">知识空间</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {SPACES.map((s) => (
                  <div
                    key={s.name}
                    className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft transition hover:border-brand-200 hover:shadow-base"
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.color}`}
                    >
                      <IconBook className="h-5 w-5" />
                    </span>
                    <p className="mt-3 font-medium">{s.name}</p>
                    <p className="mt-1 text-xs text-ink-400">{s.docs} 篇文档</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-ink-500">公开热门标签</h2>
                <span className="text-xs text-ink-400">团队共享笔记聚合</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {publicTagSummary.length === 0 ? (
                  <span className="text-xs text-ink-400">暂无公开标签，先公开第一篇笔记。</span>
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
            </section>

            <section className="rounded-xl border border-ink-200 bg-white shadow-soft">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="font-medium">最近更新</h2>
              </div>
              <ul className="divide-y divide-ink-100">
                {recentNotes.length === 0 ? (
                  <li className="px-5 py-10 text-center text-sm text-ink-400">暂无公开笔记更新</li>
                ) : (
                  recentNotes.map((note) => (
                    <li key={note.id}>
                      <a
                        href={`/pkm/notes/${note.id}`}
                        className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-ink-100/50"
                      >
                        <IconBook className="h-4 w-4 text-ink-400" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title}</span>
                        <span className="hidden text-xs text-ink-400 sm:inline">
                          {note.project?.name || "未关联项目"} · {note.user.name || note.user.email}
                        </span>
                        <span className="shrink-0 text-xs text-ink-400">{formatDate(note.updatedAt)}</span>
                      </a>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
