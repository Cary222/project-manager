import { AppShell } from "@/components/AppShell";
import { IconPkm, IconTag } from "@/components/icons";

export const dynamic = "force-dynamic";

const NOTES = [
  {
    title: "Redis 缓存穿透解决方案",
    tags: ["Redis", "缓存"],
    date: "2024-06-01",
    excerpt:
      "针对缓存穿透问题，可采用布隆过滤器拦截无效 key，并对空结果做短时缓存，避免恶意请求击穿到数据库。",
    color: "bg-rose-50 text-rose-600",
  },
  {
    title: "Go 并发模型与 Channel 最佳实践",
    tags: ["Go", "并发"],
    date: "2024-05-31",
    excerpt:
      "通过 worker pool 控制并发度，使用 context 传递取消信号，避免 goroutine 泄漏。",
    color: "bg-cyan-50 text-cyan-600",
  },
  {
    title: "MySQL 索引优化笔记",
    tags: ["MySQL", "数据库"],
    date: "2024-05-29",
    excerpt:
      "复合索引遵循最左前缀原则，覆盖索引可减少回表，注意区分度对索引选择的影响。",
    color: "bg-amber-50 text-warning",
  },
  {
    title: "光伏云平台监控埋点设计",
    tags: ["监控", "架构"],
    date: "2024-05-28",
    excerpt:
      "采用指标 + 日志 + 链路三位一体监控体系，关键路径埋点上报，结合告警阈值实现快速定位。",
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    title: "Docker 常用命令速查",
    tags: ["Docker", "运维"],
    date: "2024-05-26",
    excerpt:
      "整理日常容器构建、调试、清理相关命令，配合 compose 编排提升本地开发效率。",
    color: "bg-violet-50 text-purple",
  },
];

const CATEGORIES = [
  { name: "技术笔记", count: 126 },
  { name: "架构设计", count: 38 },
  { name: "踩坑记录", count: 52 },
  { name: "学习心得", count: 21 },
];

export default function PkmPage() {
  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">PKM · 个人知识库</h1>
          <p className="text-xs text-ink-400">
            Personal Knowledge Management · 沉淀经验，驱动成长
          </p>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">
            预览
          </span>
          PKM 功能正在开发中，以下为界面预览（静态示例数据）。
        </div>

        <div className="grid gap-5 lg:grid-cols-4">
          {/* 分类侧栏 */}
          <aside className="space-y-3 lg:col-span-1">
            <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
              <h2 className="mb-3 text-sm font-medium text-ink-500">分类</h2>
              <ul className="space-y-1">
                <li className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
                  全部笔记
                  <span className="text-xs text-brand-600">237</span>
                </li>
                {CATEGORIES.map((c) => (
                  <li
                    key={c.name}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-600 hover:bg-ink-100"
                  >
                    {c.name}
                    <span className="text-xs text-ink-400">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-soft">
              <h2 className="mb-3 text-sm font-medium text-ink-500">热门标签</h2>
              <div className="flex flex-wrap gap-2">
                {["Redis", "Go", "MySQL", "Docker", "架构", "监控", "并发"].map(
                  (t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600"
                    >
                      <IconTag className="h-3 w-3 text-ink-400" />
                      {t}
                    </span>
                  )
                )}
              </div>
            </div>
          </aside>

          {/* 笔记列表 */}
          <div className="space-y-3 lg:col-span-3">
            {NOTES.map((n) => (
              <article
                key={n.title}
                className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft transition hover:border-brand-200 hover:shadow-base"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${n.color}`}
                  >
                    <IconPkm className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium text-ink-900">{n.title}</h3>
                      <span className="shrink-0 text-xs text-ink-400">{n.date}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-ink-500">{n.excerpt}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {n.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs text-ink-500"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
