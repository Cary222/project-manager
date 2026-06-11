import dynamic from "next/dynamic";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProjectDetailLoading } from "@/components/ProjectDetail";

const ProjectDetail = dynamic(
  () => import("@/components/ProjectDetail").then((mod) => mod.ProjectDetail),
  {
    loading: () => (
      <AppShell header={<ProjectDetailHeaderSkeleton />}>
        <ProjectDetailLoading />
      </AppShell>
    ),
  }
);

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <AppShell header={<ProjectDetailHeader />}>
      <ProjectDetail projectId={projectId} />
    </AppShell>
  );
}

function ProjectDetailHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 animate-pulse rounded-lg bg-ink-200" />
      <div className="space-y-2">
        <div className="h-5 w-32 animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-48 animate-pulse rounded bg-ink-100" />
      </div>
    </div>
  );
}

function ProjectDetailHeader() {
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/projects"
        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
        aria-label="返回项目列表"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Link>
      <div>
        <h1 className="text-lg font-semibold leading-tight">项目详情</h1>
        <p className="text-xs text-ink-400">加载中…</p>
      </div>
    </div>
  );
}
