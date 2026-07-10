import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import { getWeeklyReport, getUserWeeklyReport } from "@/features/weekly-reports/lib/weekly-report-store";
import { WeeklyReportDetailClient } from "./WeeklyReportDetailClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function WeeklyReportDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // 优先查询当前用户的周报（可编辑）
  let report = await getWeeklyReport(id, session.user.id);
  let isOwnReport = true;

  // 如果不是当前用户的周报，则只读查询
  if (!report) {
    report = await getUserWeeklyReport(id);
    isOwnReport = false;
  }

  if (!report) {
    notFound();
  }

  // 如果是查看他人周报，返回到该用户的个人主页
  const backHref = isOwnReport ? "/reports/weekly-reports" : `/team/${report.userId}`;
  const backLabel = isOwnReport ? "返回周报列表" : "返回个人主页";

  return (
    <AppShell
      header={
        <BackPageHeader
          backHref={backHref}
          backLabel={backLabel}
          title="周报详情"
          subtitle={isOwnReport ? "我的周报" : `${(report as any).user?.name || (report as any).user?.email || "他人"} 的周报`}
        />
      }
    >
      <div className="mx-auto max-w-4xl px-0 sm:px-2">
        <div className="pm-fade-in">
          <WeeklyReportDetailClient initialReport={report} reportId={id} isOwnReport={isOwnReport} />
        </div>
      </div>
    </AppShell>
  );
}
