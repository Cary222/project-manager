import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserProfileAction } from "@/features/profile/lib/profile-actions";
import { listUserExpenses } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { UserExpenseList } from "@/features/team/ui/UserExpenseList";

type Props = { params: Promise<{ id: string }> };

export default async function TeamMemberExpensesPage({ params }: Props) {
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

  const expenses = await listUserExpenses(id);

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref={`/team/${id}`}
          backLabel="返回个人主页"
          title={isOwnProfile ? "我的报销" : `${profile.name || profile.email} 的报销`}
          subtitle={isOwnProfile ? "个人报销记录" : "查看他人的报销记录"}
        />
      }
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 pm-fade-in">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-ink-900">
            {expenses.length > 0 ? `共 ${expenses.length} 笔报销` : "报销列表"}
          </h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {isOwnProfile
              ? "记录和管理你的报销"
              : `${profile.name || profile.email} 提交的所有报销`}
          </p>
        </div>

        <UserExpenseList
          expenses={expenses}
          userName={profile.name || profile.email}
          isOwnProfile={isOwnProfile}
        />
      </div>
    </AppShell>
  );
}
