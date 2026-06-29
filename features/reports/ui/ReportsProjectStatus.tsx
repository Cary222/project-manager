"use client";

type ProjectHealthBucket = {
  good: number;
  normal: number;
  attention: number;
  risk: number;
};

export function ReportsProjectStatus({ status }: { status: ProjectHealthBucket }) {
  const total = status.good + status.normal + status.attention + status.risk || 1;

  const goodPct     = Math.round((status.good / total) * 100);
  const normalPct   = Math.round((status.normal / total) * 100);
  const attentionPct= Math.round((status.attention / total) * 100);
  const riskPct     = 100 - goodPct - normalPct - attentionPct;

  const LEGEND = [
    { c: "bg-emerald-500", l: "良好", v: status.good },
    { c: "bg-brand-500",   l: "正常", v: status.normal },
    { c: "bg-amber-500",   l: "关注", v: status.attention },
    { c: "bg-red-500",     l: "风险", v: status.risk },
  ];

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <h2 className="mb-4 font-medium">项目状态占比</h2>
      <div className="flex items-center justify-center">
        <div className="relative flex h-32 w-32 items-center justify-center rounded-full">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(
                var(--color-emerald-500) 0% ${goodPct}%,
                var(--color-brand-500) ${goodPct}% ${goodPct + normalPct}%,
                var(--color-amber-500) ${goodPct + normalPct}% ${goodPct + normalPct + attentionPct}%,
                var(--color-red-500) ${goodPct + normalPct + attentionPct}% 100%
              )`,
            }}
          />
          <div className="relative flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white">
            <span className="text-xl font-semibold">{total}</span>
            <span className="text-xs text-ink-400">项目</span>
          </div>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {LEGEND.map((x) => (
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
  );
}
