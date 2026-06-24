import dynamic from "next/dynamic";
import { AppShell } from "@/shared/ui/AppShell";
import { BackPageHeader } from "@/shared/ui/headers";
import {
  DispatchProjectDetailLoading,
  DispatchProjectDetailHeaderSkeleton,
} from "@/features/dispatch/ui/DispatchProjectDetail";

const DispatchProjectDetail = dynamic(
  () => import("@/features/dispatch/ui/DispatchProjectDetail").then((mod) => mod.DispatchProjectDetail),
  {
    loading: () => (
        <DispatchProjectDetailLoading />
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
