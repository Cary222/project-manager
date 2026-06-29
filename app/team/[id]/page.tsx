import { AppShell } from "@/shared/ui/AppShell";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction, getTeamMembersAction } from "@/features/profile/lib/profile-actions";
import { ProfileHeader } from "@/features/team/ui/ProfileHeader";
import { ProfileTicketList } from "@/features/team/ui/ProfileTicketList";
import { ProfileProjectList } from "@/features/team/ui/ProfileProjectList";
import { ProfileAiSummary } from "@/features/team/ui/ProfileAiSummary";
import Link from "next/link";

type Props = { params: Promise<{ id: string }> };

export default async function TeamMemberPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [profile, members] = await Promise.all([
    getUserProfileAction(id).catch(() => null),
    getTeamMembersAction(),
  ]);

  if (!profile) {
    notFound();
  }

  const isOwnProfile = id === session.user.id;

  return (
    <AppShell
      header={
        <div className="flex items-center gap-2">
          <Link href="/team" className="text-xs text-ink-400 hover:text-ink-600 transition">
            ← 个人与团队
          </Link>
          <span className="text-ink-300">/</span>
          <h1 className="text-lg font-semibold leading-tight">
            {profile.name || profile.email}
            {isOwnProfile && <span className="ml-2 text-xs font-normal text-ink-400">（我）</span>}
          </h1>
        </div>
      }
    >
      <div className="space-y-6 pm-fade-in">
        <ProfileHeader profile={profile} />

        {/* AI 画像区块（基于对话摘要生成） */}
        <ProfileAiSummary
          aiProfile={profile.aiProfile}
          isOwnProfile={isOwnProfile}
          userId={id}
          userName={profile.name || profile.email}
        />

        <div className="grid gap-5 lg:grid-cols-2">
          {/* 最近任务 */}
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink-700">最近任务</h3>
              <span className="text-xs text-ink-400">最近 {profile.recentTickets.length} 条</span>
            </div>
            <ProfileTicketList tickets={profile.recentTickets} />
          </div>

          {/* 参与项目 */}
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink-700">参与项目</h3>
              <span className="text-xs text-ink-400">{profile.stats.activeProjects} 个</span>
            </div>
            <ProfileProjectList projects={profile.projects} />
          </div>
        </div>

        {/* AI 助手快捷入口（与画像区分） */}
        <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/30 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
              <span className="text-lg">🤖</span>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium text-brand-700">AI 对话助手</h3>
              <p className="mt-1 text-xs text-ink-500">
                {isOwnProfile
                  ? "与 AI 助手对话，深入探讨您的工作内容、解决技术问题，或更新您的个人画像。"
                  : `基于 ${profile.name || profile.email} 的任务、项目、周报数据，AI 可以回答其工作相关问题。`}
              </p>
              <a
                href={`/ai?profile=${id}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700"
              >
                与 AI 聊聊 {isOwnProfile ? "我的" : "他的"} 工作
              </a>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
