import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { getExpenseById } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { MonthlyExpenseDetailClient } from "./MonthlyExpenseDetailClient";

export const dynamic = "force-dynamic";

export default async function MonthlyExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const expense = await getExpenseById(id);

  if (!expense || expense.status !== "ACTIVE") {
    notFound();
  }

  // 创建者或被关联用户都可以查看
  const isCreator = expense.userId === session.user.id;
  const isShared = expense.shares?.some((s) => s.userId === session.user.id);

  if (!isCreator && !isShared) {
    redirect("/reports/monthly-expenses");
  }

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref="/reports/monthly-expenses"
          backLabel="返回报销列表"
          title="报销详情"
          subtitle={`${expense.month} · ${expense.expenseType}`}
        />
      }
    >
      <div className="mx-auto max-w-2xl px-0 sm:px-6">
        <MonthlyExpenseDetailClient expense={expense} isCreator={isCreator} />
      </div>
    </AppShell>
  );
}
