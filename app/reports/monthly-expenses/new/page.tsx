import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { MonthlyExpenseForm } from "@/features/reports/monthly-expenses/ui/MonthlyExpenseForm";

export const dynamic = "force-dynamic";

export default async function NewMonthlyExpensePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref="/reports/monthly-expenses"
          backLabel="返回报销列表"
          title="新建报销"
          subtitle="Monthly Expense · New"
        />
      }
    >
      <div className="mx-auto max-w-2xl px-0 sm:px-6">
        <div className="pm-fade-in">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-ink-900">填写报销</h2>
            <p className="mt-1 text-sm text-ink-500">
              记录本月报销，可选择多种报销类型并上传附件。
            </p>
          </div>

          <MonthlyExpenseForm mode="create" />
        </div>
      </div>
    </AppShell>
  );
}
