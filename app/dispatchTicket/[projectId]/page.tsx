import dynamic from "next/dynamic";
import { AppShell } from "@/components/AppShell";
import { BackPageHeader } from "@/components/ui/headers";
import {
  DispatchProjectDetailLoading,
  DispatchProjectDetailHeaderSkeleton,
} from "@/components/dispatch/DispatchProjectDetail";

const DispatchProjectDetail = dynamic(
  () => import("@/components/dispatch/DispatchProjectDetail").then((mod) => mod.DispatchProjectDetail),
  {
    loading: () => (
      <AppShell header={<DispatchProjectDetailHeaderSkeleton />}>
        <DispatchProjectDetailLoading />
      </AppShell>
    ),
  }
);

export default async function DispatchProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <AppShell header={<BackPageHeader backHref="/dispatchTicket" backLabel="返回派单" title="派单" subtitle="项目详情" />}>
      <DispatchProjectDetail projectId={projectId} />
    </AppShell>
  );
}
