import { AppShell } from "@/shared/ui/AppShell";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction, getTeamMembersAction } from "@/features/profile/lib/profile-actions";
import { ProfileHeader } from "@/features/team/ui/ProfileHeader";
import { ProfileTicketList } from "@/features/team/ui/ProfileTicketList";
import { ProfileProjectList } from "@/features/team/ui/ProfileProjectList";
import { TeamMemberCard } from "@/features/team/ui/TeamMemberCard";
import { getWeekRange, formatWeekLabel } from "@/shared/lib/week";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [profile, members] = await Promise.all([
    getUserProfileAction(session.user.id),
    getTeamMembersAction(),
  ]);

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">个人与团队</h1>
          <p className="text-xs text-ink-400">Profile · 成员画像与协作</p>
        </div>
      }
    >
      <div className="space-y-6 pm-fade-in">
        {/* 个人区块 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-700">我的工作台</h2>
            <Link
              href={`/team/${session.user.id}`}
              className="text-xs text-brand-600 hover:text-brand-700"
            >
              查看完整画像 →
            </Link>
          </div>

          <ProfileHeader profile={profile} />

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-ink-700">最近任务</h3>
                <Link href="/tasks" className="text-xs text-brand-600 hover:text-brand-700">
                  全部任务 →
                </Link>
              </div>
              <ProfileTicketList tickets={profile.recentTickets} />
            </div>

            <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-ink-700">参与项目</h3>
                <Link href="/projects" className="text-xs text-brand-600 hover:text-brand-700">
                  全部项目 →
                </Link>
              </div>
              <ProfileProjectList projects={profile.projects} />
            </div>
          </div>

          {/* 本周周报快捷入口 */}
          {profile.recentReports.length > 0 && (
            <div className="mt-5 rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-ink-700">周报</h3>
                <Link href="/reports/weekly-reports" className="text-xs text-brand-600 hover:text-brand-700">
                  全部周报 →
                </Link>
              </div>
              <div className="space-y-2">
                {profile.recentReports.map((r) => {
                  const { weekStart, weekEnd } = getWeekRange(r.weekStart);
                  return (
                    <Link
                      key={r.id}
                      href={`/reports/weekly-reports/${r.id}`}
                      className="flex items-center justify-between rounded-lg border border-ink-100 px-4 py-2.5 transition hover:border-brand-200 hover:bg-brand-50/20"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        <p className="mt-0.5 text-xs text-ink-400">{formatWeekLabel(weekStart, weekEnd)}</p>
                      </div>
                      {r.hasAiSummary ? (
                        <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                          AI 总结
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-ink-400">待生成</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* 团队成员区块 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-700">
              团队成员 <span className="font-normal text-ink-400">({members.length} 人)</span>
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <TeamMemberCard key={m.id} member={m} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
