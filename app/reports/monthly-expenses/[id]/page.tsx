import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { getMyExpenseById, getExpenseById } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
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

  // 优先查询当前用户的报销（可编辑）
  let expense = await getMyExpenseById(id, session.user.id);
  let isCreator = true;

  // 如果不是当前用户的报销，则只读查询
  if (!expense) {
    expense = await getExpenseById(id);
    isCreator = false;
  }

  if (!expense || expense.status !== "ACTIVE") {
    notFound();
  }

  // 创建者可编辑；ROOT 也可编辑他人报销
  const canEdit = isCreator || session.user.role === "ROOT";

  // 查看他人报销时，返回该用户的个人主页
  const backHref = isCreator ? "/reports/monthly-expenses" : `/team/${expense.userId}`;
  const backLabel = isCreator ? "返回报销列表" : "返回个人主页";

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref={backHref}
          backLabel={backLabel}
          title="报销详情"
          subtitle={`${expense.month} · ${expense.expenseType}`}
        />
      }
    >
      <div className="mx-auto max-w-2xl px-0 sm:px-6">
        <MonthlyExpenseDetailClient expense={expense} isCreator={isCreator} canEdit={canEdit} />
      </div>
    </AppShell>
  );
}
