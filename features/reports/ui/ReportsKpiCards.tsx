"use client";

import { IconTrend } from "@/shared/ui/icons";

type KpiStats = {
  activeProjects: number;
  completionRate: number;
  monthlyTickets: number;
  teamHealth: number;
};

const CARDS = [
  { key: "activeProjects",  label: "进行中项目", unit: "个" },
  { key: "completionRate",  label: "按期完成率",  unit: "%" },
  { key: "teamHealth",      label: "团队健康度",  unit: "%" },
  { key: "monthlyTickets",  label: "本月任务数",  unit: "个" },
] as const;

const TONES: Record<string, string> = {
  activeProjects:  "text-brand-600",
  completionRate:  "text-emerald-600",
  teamHealth:      "text-violet-600",
  monthlyTickets:  "text-warning",
};

function formatValue(key: string, value: number): string {
  return `${value}${CARDS.find((c) => c.key === key)?.unit ?? ""}`;
}

export function ReportsKpiCards({ kpis }: { kpis: KpiStats }) {
  return (
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {CARDS.map((card) => {
        const value = kpis[card.key as keyof KpiStats] as number;
        return (
          <div
            key={card.key}
            className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft"
          >
            <p className="text-sm text-ink-500">{card.label}</p>
            <div className="mt-2 flex items-end justify-between">
              <p className={`text-3xl font-semibold ${TONES[card.key]}`}>
                {formatValue(card.key, value)}
              </p>
              <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                <IconTrend className="h-3.5 w-3.5" />
                —
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
