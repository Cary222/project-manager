interface PriorityBadgeProps {
  priority: number;
}

const STYLES: Record<number, string> = {
  0: "bg-red-100 text-red-700 border-red-300",
  1: "bg-amber-100 text-amber-700 border-amber-300",
  2: "bg-brand-50 text-brand-700 border-brand-200",
  3: "bg-ink-100 text-ink-500 border-ink-200",
};

const LABELS: Record<number, string> = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
};

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
        STYLES[priority] ?? STYLES[2]
      }`}
    >
      {LABELS[priority] ?? "P2"}
    </span>
  );
}
