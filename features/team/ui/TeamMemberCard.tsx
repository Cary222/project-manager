import Link from "next/link";
import type { TeamMember } from "@/features/profile/lib/profile-actions";

type Props = {
  member: TeamMember;
};

const ROLE_LABELS: Record<string, string> = {
  ROOT: "管理员",
  USER: "成员",
  ADMIN: "管理员",
};

export function TeamMemberCard({ member }: Props) {
  const initial = (member.name || member.email || "U").charAt(0).toUpperCase();
  const tone = getTone(member.role);

  return (
    <Link
      href={`/team/${member.id}`}
      className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white p-4 transition hover:border-brand-200 hover:bg-brand-50/30 hover:shadow-soft"
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold ${tone}`}
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-ink-900">{member.name || "未命名"}</p>
          {member.role !== "USER" && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
              {ROLE_LABELS[member.role] ?? member.role}
            </span>
          )}
        </div>
        {member.bio ? (
          <p className="mt-1 truncate text-xs text-ink-400">{member.bio}</p>
        ) : null}
        {member.hasAiProfile ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-violet-600">
            <span aria-hidden>✨</span> AI 画像
          </p>
        ) : null}
        {member.skills.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {member.skills.slice(0, 4).map((s) => (
              <span
                key={s.kind}
                className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500"
              >
                {s.kind}
              </span>
            ))}
            {member.skills.length > 4 && (
              <span className="text-[11px] text-ink-400">+{member.skills.length - 4}</span>
            )}
          </div>
        ) : null}
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
        <span className="text-sm font-medium text-ink-700">{member.stats.totalTickets}</span>
        <span className="text-[11px] text-ink-400">任务</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
          {Math.round((member.stats.completedTickets / Math.max(member.stats.totalTickets, 1)) * 100)}%完成
        </span>
      </div>
    </Link>
  );
}

function getTone(role: string): string {
  switch (role) {
    case "ROOT":
      return "bg-amber-100 text-amber-700";
    case "ADMIN":
      return "bg-violet-100 text-purple";
    default:
      return "bg-brand-50 text-brand-600";
  }
}
