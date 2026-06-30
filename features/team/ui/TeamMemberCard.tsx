import Link from "next/link";
import type { TeamMember } from "@/features/profile/lib/profile-actions";
import { IconSparkles } from "@/shared/ui/icons";

type Props = {
  member: TeamMember;
};

const ROLE_LABELS: Record<string, string> = {
  ROOT: "管理员",
  USER: "成员",
  ADMIN: "管理员",
};

const BADGE = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-brand-100 text-brand-800",
  neutral: "bg-ink-100 text-ink-700",
} as const;

export function TeamMemberCard({ member }: Props) {
  const initial = (member.name || member.email || "U").charAt(0).toUpperCase();
  const tone = getTone(member.role);
  const completionRate = Math.round((member.stats.completedTickets / Math.max(member.stats.totalTickets, 1)) * 100);

  return (
    <Link
      href={`/team/${member.id}`}
      className="group pm-fade-in flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-ink-300 hover:shadow lg:p-5"
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
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE.neutral}`}>
              {ROLE_LABELS[member.role] ?? member.role}
            </span>
          )}
        </div>
        {member.bio ? (
          <p className="mt-1 truncate text-xs text-ink-400">{member.bio}</p>
        ) : null}
        {member.hasAiProfile && (
          <span className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-purple-700`}>
            <IconSparkles className="h-3 w-3" />
            AI 画像
          </span>
        )}
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
        <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${BADGE.success}`}>
          {completionRate}%完成
        </span>
      </div>
    </Link>
  );
}

function getTone(role: string): string {
  switch (role) {
    case "ROOT":
      return "bg-amber-100 text-amber-800";
    case "ADMIN":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-brand-100 text-brand-800";
  }
}
