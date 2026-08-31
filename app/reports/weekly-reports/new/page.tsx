import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { WeeklyReportForm } from "@/features/reports/weekly-reports/ui/WeeklyReportForm";
import { formatBeijingDateInput, getWeekRange } from "@/features/weekly-reports/lib/week";

export const dynamic = "force-dynamic";

export default async function NewWeeklyReportPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { weekStart, weekEnd } = getWeekRange(new Date());

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref="/reports/weekly-reports"
          backLabel="返回周报列表"
          title="新建周报"
          subtitle="Weekly Report · New"
        />
      }
    >
      <div className="mx-auto max-w-4xl px-0 sm:px-6">
        <div className="pm-fade-in">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-ink-900">填写周报</h2>
            <p className="mt-1 text-sm text-ink-500">
              提交后 AI 将自动生成结构化总结，可在详情页查看。
            </p>
          </div>

          <WeeklyReportForm
            initialWeekStart={formatBeijingDateInput(weekStart)}
            initialWeekEnd={formatBeijingDateInput(weekEnd)}
          />
        </div>
      </div>
    </AppShell>
  );
}
