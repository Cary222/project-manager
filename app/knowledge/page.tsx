import { AppShell } from "@/components/AppShell";
import { IconBook } from "@/components/icons";
import { KnowledgeSearchPanel } from "@/components/search/KnowledgeSearchPanel";

const SPACES = [
  { name: "光伏云平台", docs: 42, color: "bg-brand-50 text-brand-600" },
  { name: "物联网网关服务", docs: 28, color: "bg-emerald-50 text-emerald-600" },
  { name: "内部运营系统", docs: 19, color: "bg-amber-50 text-warning" },
  { name: "通用研发规范", docs: 35, color: "bg-violet-50 text-purple" },
];

const RECENT = [
  { title: "登录鉴权统一接入文档", space: "光伏云平台", author: "张三", date: "2024-06-01" },
  { title: "Git 提交规范与单号关联说明", space: "通用研发规范", author: "cary", date: "2024-05-31" },
  { title: "网关协议适配指南", space: "物联网网关服务", author: "李四", date: "2024-05-30" },
  { title: "数据库 schema 设计约定", space: "通用研发规范", author: "王五", date: "2024-05-28" },
];

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const initialQuery = params?.q ?? "";
  const showSearchResults = initialQuery.trim().length > 0;

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
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">预览</span>
          知识库已开放第一版团队知识搜索，当前结果来自工单与提交记录。
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

            <section className="rounded-xl border border-ink-200 bg-white shadow-soft">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="font-medium">最近更新</h2>
              </div>
              <ul className="divide-y divide-ink-100">
                {RECENT.map((d) => (
                  <li
                    key={d.title}
                    className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-ink-100/50"
                  >
                    <IconBook className="h-4 w-4 text-ink-400" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {d.title}
                    </span>
                    <span className="hidden text-xs text-ink-400 sm:inline">
                      {d.space} · {d.author}
                    </span>
                    <span className="shrink-0 text-xs text-ink-400">{d.date}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
