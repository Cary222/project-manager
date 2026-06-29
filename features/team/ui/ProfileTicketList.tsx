import Link from "next/link";
import type { UserTicketSummary } from "@/features/profile/lib/profile-actions";

type Props = {
  tickets: UserTicketSummary[];
};

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  TODO: { label: "待办", tone: "bg-ink-100 text-ink-500" },
  IN_PROGRESS: { label: "进行中", tone: "bg-brand-50 text-brand-600" },
  REVIEW: { label: "待审核", tone: "bg-violet-50 text-purple" },
  COMPLETED: { label: "已完成", tone: "bg-emerald-50 text-emerald-600" },
  CLOSED: { label: "已关闭", tone: "bg-ink-100 text-ink-400" },
  DONE: { label: "已完成", tone: "bg-emerald-50 text-emerald-600" },
  OPEN: { label: "开放", tone: "bg-amber-50 text-amber-600" },
};

export function ProfileTicketList({ tickets }: Props) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/30 p-6 text-center text-sm text-ink-400">
        暂无任务记录
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tickets.map((t) => {
        const statusInfo = STATUS_LABELS[t.status] ?? { label: t.status, tone: "bg-ink-100 text-ink-500" };
        return (
          <Link
            key={t.id}
            href={`/tickets/${t.id}`}
            className="flex items-center gap-3 rounded-lg border border-ink-100 bg-white px-4 py-3 transition hover:border-brand-200 hover:bg-brand-50/20"
          >
            <span className="shrink-0 text-sm font-mono font-medium text-ink-400">#{t.ticketNo}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusInfo.tone}`}>
                {statusInfo.label}
              </span>
              <div className="w-16 rounded-full bg-ink-100">
                <div
                  className="h-1.5 rounded-full bg-brand-500"
                  style={{ width: `${t.progress}%` }}
                />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
