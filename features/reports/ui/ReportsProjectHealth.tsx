"use client";

type ProjectHealthDetail = {
  id: string;
  name: string;
  progress: number; // 0-100
  status: "good" | "normal" | "attention" | "risk";
};

const STATUS_TONE: Record<ProjectHealthDetail["status"], string> = {
  good:      "bg-emerald-500",
  normal:    "bg-brand-500",
  attention: "bg-amber-500",
  risk:      "bg-red-500",
};

const STATUS_LABEL: Record<ProjectHealthDetail["status"], string> = {
  good:      "良好",
  normal:    "正常",
  attention: "关注",
  risk:      "风险",
};

export function ReportsProjectHealth({ projects }: { projects: ProjectHealthDetail[] }) {
  if (projects.length === 0) {
    return (
      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <h2 className="mb-4 font-medium">项目进度概览</h2>
        <p className="text-sm text-ink-400">暂无活跃项目</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <h2 className="mb-4 font-medium">项目进度概览</h2>
      <ul className="space-y-4">
        {projects.map((p) => (
          <li key={p.id}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-ink-400">
                {p.progress}% · {STATUS_LABEL[p.status]}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100">
              <div
                className={`h-full rounded-full ${STATUS_TONE[p.status]}`}
                style={{ width: `${p.progress}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
