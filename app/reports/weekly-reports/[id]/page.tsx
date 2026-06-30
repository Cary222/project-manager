import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { getWeeklyReport } from "@/features/weekly-reports/lib/weekly-report-store";
import { WeeklyReportDetailClient } from "./WeeklyReportDetailClient";

type Props = { params: Promise<{ id: string }> };

export default async function WeeklyReportDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const report = await getWeeklyReport(id, session.user.id);

  if (!report) {
    notFound();
  }

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref="/reports/weekly-reports"
          backLabel="返回周报列表"
          title="周报详情"
          subtitle="Weekly Report · Detail"
        />
      }
    >
      <div className="mx-auto max-w-4xl px-0 sm:px-2">
        <div className="pm-fade-in">
          <WeeklyReportDetailClient initialReport={report} reportId={id} />
        </div>
      </div>
    </AppShell>
  );
}
