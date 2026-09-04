import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { listMyExpenses } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { MonthlyExpenseList } from "@/features/reports/monthly-expenses/ui/MonthlyExpenseList";

export const dynamic = "force-dynamic";

export default async function MonthlyExpensesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const expenses = await listMyExpenses(session.user.id);

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref="/reports"
          backLabel="返回报表"
          title="我的报销"
          subtitle="Monthly Expenses · 个人报销记录"
        />
      }
    >
      <div className="mx-auto max-w-3xl px-0 sm:px-6">
        <div className="pm-fade-in">
          {/* Section title + create button */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-ink-900">
                {expenses.length > 0 ? `共 ${expenses.length} 条报销记录` : "报销记录"}
              </h2>
              <p className="mt-0.5 text-sm text-ink-500">
                记录你的每月报销，支持多种报销类型
              </p>
            </div>
            <Link
              href="/reports/monthly-expenses/new"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
            >
              新建报销
            </Link>
          </div>

          <MonthlyExpenseList initialExpenses={expenses} />
        </div>
      </div>
    </AppShell>
  );
}
