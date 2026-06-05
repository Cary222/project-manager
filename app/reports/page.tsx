import { AppShell } from "@/components/AppShell";
import { IconTrend } from "@/components/icons";

export const dynamic = "force-dynamic";

const KPIS = [
  { label: "进行中项目", value: "18", delta: "+2", up: true, tone: "text-brand-600" },
  { label: "按期完成率", value: "78%", delta: "+5%", up: true, tone: "text-emerald-600" },
  { label: "团队健康度", value: "92%", delta: "+3%", up: true, tone: "text-violet-600" },
  { label: "本月任务数", value: "342", delta: "+18", up: true, tone: "text-warning" },
];

const PROJECT_HEALTH = [
  { name: "光伏云平台", progress: 72, status: "良好", tone: "bg-emerald-500" },
  { name: "物联网网关服务", progress: 58, status: "正常", tone: "bg-brand-500" },
  { name: "内部运营系统", progress: 41, status: "关注", tone: "bg-amber-500" },
  { name: "员工考勤系统", progress: 88, status: "良好", tone: "bg-emerald-500" },
  { name: "数据中台", progress: 34, status: "风险", tone: "bg-red-500" },
];

const TOP_MEMBERS = [
  { name: "张三", done: 48, rate: 96 },
  { name: "cary", done: 42, rate: 91 },
  { name: "李四", done: 37, rate: 88 },
  { name: "王五", done: 31, rate: 85 },
];

// 任务趋势（近 6 周示例）
const TREND = [120, 145, 138, 167, 152, 188];

export default function ReportsPage() {
  const max = Math.max(...TREND);
  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">老板看板 · 报表</h1>
          <p className="text-xs text-ink-400">Management Dashboard · 全局经营视角</p>
        </div>
      }
    >
      <div className="space-y-6 pm-fade-in">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">预览</span>
          老板看板正在开发中，以下为界面预览（静态示例数据）。
        </div>

        {/* KPI */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {KPIS.map((k) => (
            <div
              key={k.label}
              className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft"
            >
              <p className="text-sm text-ink-500">{k.label}</p>
              <div className="mt-2 flex items-end justify-between">
                <p className={`text-3xl font-semibold ${k.tone}`}>{k.value}</p>
                <span
                  className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                    k.up ? "text-emerald-600" : "text-danger"
                  }`}
                >
                  <IconTrend className="h-3.5 w-3.5" />
                  {k.delta}
                </span>
              </div>
            </div>
          ))}
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          {/* 任务趋势 */}
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">任务交付趋势</h2>
              <span className="text-xs text-ink-400">近 6 周</span>
            </div>
            <div className="flex h-48 items-end gap-4">
              {TREND.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-brand-500 to-brand-400 transition-all"
                    style={{ height: `${(v / max) * 100}%` }}
                  />
                  <span className="text-xs text-ink-400">W{i + 1}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 项目状态占比 */}
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 font-medium">项目状态占比</h2>
            <div className="flex items-center justify-center">
              <div className="relative flex h-32 w-32 items-center justify-center rounded-full">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "conic-gradient(var(--color-success) 0% 56%, var(--color-brand-500) 56% 78%, var(--color-warning) 78% 92%, var(--color-danger) 92% 100%)",
                  }}
                />
                <div className="relative flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white">
                  <span className="text-xl font-semibold">18</span>
                  <span className="text-xs text-ink-400">项目</span>
                </div>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {[
                { c: "bg-success", l: "良好", v: "10" },
                { c: "bg-brand-500", l: "正常", v: "4" },
                { c: "bg-warning", l: "关注", v: "3" },
                { c: "bg-danger", l: "风险", v: "1" },
              ].map((x) => (
                <li key={x.l} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${x.c}`} />
                    {x.l}
                  </span>
                  <span className="text-ink-500">{x.v}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 项目健康度 */}
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 font-medium">项目进度概览</h2>
            <ul className="space-y-4">
              {PROJECT_HEALTH.map((p) => (
                <li key={p.name}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-ink-400">
                      {p.progress}% · {p.status}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={`h-full rounded-full ${p.tone}`}
                      style={{ width: `${p.progress}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* 成员 TOP */}
          <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 font-medium">成员贡献 TOP</h2>
            <ul className="space-y-3">
              {TOP_MEMBERS.map((m, i) => (
                <li key={m.name} className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-ink-100 text-ink-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm font-medium">{m.name}</span>
                  <span className="text-sm text-ink-500">完成 {m.done}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
                    {m.rate}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
