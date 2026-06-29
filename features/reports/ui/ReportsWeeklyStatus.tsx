"use client";

import Link from "next/link";
import { formatWeekLabel } from "@/shared/lib/week";

type UserSummary = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
};

type WeeklyReportStatus = {
  submitted: UserSummary[];
  missing:   UserSummary[];
  weekStart: Date;
  weekEnd:   Date;
};

function UserChip({ user }: { user: UserSummary }) {
  return (
    <Link
      href={`/team/${user.id}`}
      className="flex items-center gap-2 rounded-lg border border-ink-100 bg-white px-3 py-2 text-sm transition-colors hover:border-brand-300 hover:bg-brand-50"
    >
      {user.image ? (
        <img
          src={user.image}
          alt={user.name ?? user.email}
          className="h-6 w-6 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-medium text-brand-600">
          {(user.name ?? user.email).slice(0, 1).toUpperCase()}
        </div>
      )}
      <span className="font-medium">{user.name ?? user.email}</span>
    </Link>
  );
}

export function ReportsWeeklyStatus({ thisWeekReports }: { thisWeekReports: WeeklyReportStatus }) {
  const weekLabel = formatWeekLabel(
    new Date(thisWeekReports.weekStart),
    new Date(thisWeekReports.weekEnd)
  );

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium">本周周报状态</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-400">{weekLabel}</span>
          <Link
            href="/reports/weekly-reports"
            className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-200"
          >
            查看全部
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        {/* Submitted */}
        <div>
          <p className="mb-2 text-xs font-medium text-emerald-600">
            已提交 ({thisWeekReports.submitted.length})
          </p>
          {thisWeekReports.submitted.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {thisWeekReports.submitted.map((u) => (
                <UserChip key={u.id} user={u} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-400">暂无已提交周报</p>
          )}
        </div>

        {/* Missing */}
        <div>
          <p className="mb-2 text-xs font-medium text-red-500">
            未提交 ({thisWeekReports.missing.length})
          </p>
          {thisWeekReports.missing.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {thisWeekReports.missing.map((u) => (
                <UserChip key={u.id} user={u} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-400">全部已提交</p>
          )}
        </div>
      </div>
    </section>
  );
}
