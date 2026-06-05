import { AppShell } from "@/components/AppShell";
import { IconRepo } from "@/components/icons";

export const dynamic = "force-dynamic";

const REPOS = [
  {
    name: "solar-platform-backend",
    lang: "Go",
    branch: "main",
    commits: 328,
    desc: "光伏云平台后端服务，提供 API 接口与业务逻辑处理。",
    tone: "bg-cyan-50 text-cyan-700",
  },
  {
    name: "solar-platform-frontend",
    lang: "Vue",
    branch: "main",
    commits: 256,
    desc: "光伏云平台前端，负责数据看板与运维管理界面。",
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    name: "iot-gateway-service",
    lang: "Go",
    branch: "develop",
    commits: 142,
    desc: "物联网网关服务，处理设备接入、协议适配与消息转发。",
    tone: "bg-cyan-50 text-cyan-700",
  },
  {
    name: "ops-internal-system",
    lang: "Java",
    branch: "main",
    commits: 198,
    desc: "内部运营系统，基于 Spring Boot 的后台管理平台。",
    tone: "bg-amber-50 text-amber-700",
  },
];

export default function ReposPage() {
  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">代码仓库</h1>
          <p className="text-xs text-ink-400">Repositories · Git 仓库总览</p>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">预览</span>
          仓库浏览功能正在开发中，提交记录已通过任务详情自动关联。以下为界面预览。
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {REPOS.map((r) => (
            <div
              key={r.name}
              className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft transition hover:border-brand-200 hover:shadow-base"
            >
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                  <IconRepo className="h-5 w-5" />
                </span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${r.tone}`}>
                  {r.lang}
                </span>
              </div>
              <p className="mt-3 font-mono text-sm font-medium text-ink-900">
                {r.name}
              </p>
              <p className="mt-1.5 text-sm text-ink-500">{r.desc}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  {r.branch}
                </span>
                <span>{r.commits} commits</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
