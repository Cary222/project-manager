import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

const MEMBERS = [
  { name: "张三", role: "后端负责人", skills: ["Go", "PostgreSQL", "Redis"], tone: "bg-brand-50 text-brand-600" },
  { name: "cary", role: "全栈工程师", skills: ["Vue", "Go", "Docker"], tone: "bg-emerald-50 text-emerald-600" },
  { name: "李四", role: "前端工程师", skills: ["Vue", "TypeScript"], tone: "bg-violet-50 text-purple" },
  { name: "王五", role: "运维工程师", skills: ["Kubernetes", "Docker"], tone: "bg-amber-50 text-warning" },
  { name: "赵六", role: "数据工程师", skills: ["ClickHouse", "Python"], tone: "bg-rose-50 text-rose-600" },
  { name: "陈七", role: "测试工程师", skills: ["自动化", "性能"], tone: "bg-cyan-50 text-cyan-600" },
];

const CAPABILITY = [
  { label: "Go", value: 90 },
  { label: "Vue", value: 78 },
  { label: "PostgreSQL", value: 82 },
  { label: "Redis", value: 70 },
  { label: "Docker", value: 85 },
  { label: "Kubernetes", value: 64 },
];

export default function TeamPage() {
  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">团队</h1>
          <p className="text-xs text-ink-400">Team · 成员能力与画像</p>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">预览</span>
          团队画像功能正在开发中，以下为界面预览（静态示例数据）。
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft lg:col-span-2">
            <h2 className="mb-4 font-medium">团队成员</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {MEMBERS.map((m) => (
                <div
                  key={m.name}
                  className="flex items-center gap-3 rounded-lg border border-ink-100 p-3 transition hover:border-brand-200 hover:bg-brand-50/30"
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold ${m.tone}`}
                  >
                    {m.name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-ink-400">{m.role}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.skills.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 font-medium">团队技能分布</h2>
            <ul className="space-y-3">
              {CAPABILITY.map((c) => (
                <li key={c.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{c.label}</span>
                    <span className="text-ink-400">{c.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${c.value}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
