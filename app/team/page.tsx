import { AppShell } from "@/shared/ui/AppShell";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction, getTeamMembersAction } from "@/features/profile/lib/profile-actions";
import { ProfileProjectList } from "@/features/team/ui/ProfileProjectList";
import { TeamMemberCard } from "@/features/team/ui/TeamMemberCard";

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
          <h1 className="text-lg font-semibold leading-tight">团队成员</h1>
          <p className="text-xs text-ink-400">Team · {members.length} 位成员</p>
        </div>
      }
    >
      <div className="space-y-6 pm-fade-in">
        {/* 团队成员列表 */}
        <section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <TeamMemberCard key={m.id} member={m} />
            ))}
          </div>
        </section>

        {/* 参与项目（显示成员列表） */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-700">参与项目</h2>
          </div>
          <ProfileProjectList projects={profile.projects} showMembers />
        </section>
      </div>
    </AppShell>
  );
}
