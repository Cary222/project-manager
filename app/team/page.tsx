import { AppShell } from "@/shared/ui/AppShell";
import { SimplePageHeader } from "@/shared/ui/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction, getTeamMembersAction } from "@/features/profile/lib/profile-actions";
import { ProfileProjectList } from "@/features/team/ui/ProfileProjectList";
import { TeamMemberCard } from "@/features/team/ui/TeamMemberCard";
import { IconTeam } from "@/shared/ui/icons";

type Props = {
  searchParams: Promise<{ view?: string }>;
};

export default async function TeamPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { view } = await searchParams;
  const currentView = view === "all" ? "all" : "projects";

  const [profile, members] = await Promise.all([
    getUserProfileAction(session.user.id),
    getTeamMembersAction(),
  ]);

  return (
    <AppShell
      header={<SimplePageHeader title="团队成员" subtitle={`Team · ${members.length} 位成员`} />}
    >
      <div className="space-y-8 pm-fade-in">
        {/* 分段切换器 */}
        <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1 w-fit">
          <a
            href="/team"
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              currentView === "projects"
                ? "bg-brand-50 text-brand-700"
                : "text-ink-500 hover:bg-ink-50 hover:text-ink-700"
            }`}
          >
            按项目
          </a>
          <a
            href="/team?view=all"
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              currentView === "all"
                ? "bg-brand-50 text-brand-700"
                : "text-ink-500 hover:bg-ink-50 hover:text-ink-700"
            }`}
          >
            全部成员
          </a>
        </div>

        {currentView === "projects" ? (
          /* 参与项目 section */
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-700">参与项目</h2>
            </div>
            <ProfileProjectList projects={profile.projects} showMembers />
          </section>
        ) : (
          /* 团队成员 / 共 N 人 section */
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-700">
              团队成员 / 共 {members.length} 人
            </h2>
            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
                <div className="rounded-full bg-ink-100 p-3 text-ink-400">
                  <IconTeam className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有团队成员</h3>
                <p className="mt-1 text-sm text-ink-500">邀请同事加入团队开始协作</p>
                <button
                  type="button"
                  className="mt-4 rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-500 transition hover:bg-ink-100"
                  disabled
                >
                  邀请成员（功能开发中）
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {members.map((m) => (
                  <TeamMemberCard key={m.id} member={m} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
