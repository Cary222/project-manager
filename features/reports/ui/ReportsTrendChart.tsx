"use client";

interface ReportsTrendChartProps {
  trend: number[];
}

export function ReportsTrendChart({ trend }: ReportsTrendChartProps) {
  const max = Math.max(...trend, 1);

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft lg:col-span-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium">任务交付趋势</h2>
        <span className="text-xs text-ink-400">近 6 周</span>
      </div>
      <div className="flex h-48 items-end gap-4">
        {trend.map((v, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-2">
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-brand-500 to-brand-400 transition-all"
              style={{ height: `${Math.max((v / max) * 100, 2)}%` }}
            />
            <span className="text-xs text-ink-400">W{i + 1}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
