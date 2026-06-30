import Link from "next/link";
import type { UserTicketSummary } from "@/features/profile/lib/profile-actions";
import { IconTicket } from "@/shared/ui/icons";

type Props = {
  tickets: UserTicketSummary[];
};

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  TODO: { label: "待办", tone: "bg-ink-100 text-ink-700" },
  IN_PROGRESS: { label: "进行中", tone: "bg-brand-100 text-brand-800" },
  REVIEW: { label: "待审核", tone: "bg-purple-100 text-purple-800" },
  COMPLETED: { label: "已完成", tone: "bg-emerald-100 text-emerald-800" },
  CLOSED: { label: "已关闭", tone: "bg-ink-100 text-ink-500" },
  DONE: { label: "已完成", tone: "bg-emerald-100 text-emerald-800" },
  OPEN: { label: "开放", tone: "bg-amber-100 text-amber-800" },
};

export function ProfileTicketList({ tickets }: Props) {
  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
        <div className="rounded-full bg-ink-100 p-3 text-ink-400">
          <IconTicket className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有任务记录</h3>
        <p className="mt-1 text-sm text-ink-500">开始一个新任务来跟踪工作</p>
        <Link
          href="/tasks"
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          开始新任务
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2 pm-fade-in">
      {tickets.map((t) => {
        const statusInfo = STATUS_LABELS[t.status] ?? { label: t.status, tone: "bg-ink-100 text-ink-500" };
        return (
          <Link
            key={t.id}
            href={`/tickets/${t.id}`}
            className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-3 transition hover:border-ink-300 hover:bg-ink-50"
          >
            <span className="shrink-0 font-mono text-sm font-medium text-ink-400">#{t.ticketNo}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{t.title}</span>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusInfo.tone}`}>
                {statusInfo.label}
              </span>
              <div className="w-16 rounded-full bg-ink-200">
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
