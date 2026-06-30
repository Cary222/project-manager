import type { UserProfile } from "@/features/profile/lib/profile-actions";

type Props = {
  profile: UserProfile;
};

const ROLE_LABELS: Record<string, string> = {
  ROOT: "管理员",
  USER: "成员",
  ADMIN: "管理员",
};

export function ProfileHeader({ profile }: Props) {
  const initial = (profile.name || profile.email || "U").charAt(0).toUpperCase();

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-ink-900">
              {profile.name || "未命名成员"}
            </h2>
            <span className="rounded bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">
              {ROLE_LABELS[profile.role] ?? profile.role}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-500">{profile.email}</p>
          {profile.bio ? (
            <p className="mt-2 text-sm text-ink-600">{profile.bio}</p>
          ) : null}
        </div>
      </div>

      {/* 技能标签 */}
      {profile.skills.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {profile.skills.map((s) => (
            <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
              {s.kind}
            </span>
          ))}
        </div>
      )}

      {/* 统计数字 */}
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatItem label="创建任务" value={profile.stats.totalTickets} />
        <StatItem label="已完成" value={profile.stats.completedTickets} accent />
        <StatItem label="参与项目" value={profile.stats.activeProjects} />
        <StatItem label="周报" value={profile.stats.totalReports} />
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2.5 text-center">
      <p className={`text-2xl font-bold ${accent ? "text-emerald-600" : "text-ink-900"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-400">{label}</p>
    </div>
  );
}
