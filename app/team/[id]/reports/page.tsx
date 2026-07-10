import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction } from "@/features/profile/lib/profile-actions";
import { listUserWeeklyReports } from "@/features/weekly-reports/lib/weekly-report-store";
import { UserWeeklyReportList } from "@/features/team/ui/UserWeeklyReportList";

type Props = { params: Promise<{ id: string }> };

export default async function TeamMemberReportsPage({ params }: Props) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const profile = await getUserProfileAction(id).catch(() => null);
  if (!profile) {
    notFound();
  }

  const isOwnProfile = id === session.user.id;

  const reports = await listUserWeeklyReports(id);

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref={`/team/${id}`}
          backLabel="返回个人主页"
          title={isOwnProfile ? "我的周报" : `${profile.name || profile.email} 的周报`}
          subtitle={isOwnProfile ? "个人工作回顾" : "查看他人的工作周报"}
        />
      }
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pm-fade-in">
        {/* Section title */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-ink-900">
            {reports.length > 0 ? `共 ${reports.length} 份周报` : "周报列表"}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {isOwnProfile
              ? "提交后 AI 将自动生成结构化总结"
              : `${profile.name || profile.email} 提交的所有周报`}
          </p>
        </div>

        <UserWeeklyReportList
          reports={reports}
          userName={profile.name || profile.email}
          isOwnProfile={isOwnProfile}
        />
      </div>
    </AppShell>
  );
}
