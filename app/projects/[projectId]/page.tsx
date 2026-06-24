import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { AppShell } from "@/shared/ui/AppShell";
import {
  PageHeader,
  PageHeaderSkeleton,
  type ProjectWithStatus,
} from "@/features/project/ui/ProjectDetail";
import { ProjectDetail } from "@/features/project/ui/ProjectDetail";
import { Suspense } from "react";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireSession();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      ownerId: true,
      owner: { select: { id: true, name: true, email: true } },
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      pkmNotes: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          attachments: true,
          user: { select: { id: true, name: true } },
        },
      },
      responsibilities: {
        orderBy: { kind: "asc" },
        include: {
          modules: {
            orderBy: { name: "asc" },
            include: {
              tickets: {
                orderBy: { ticketNo: "desc" },
                include: {
                  assignees: {
                    include: {
                      user: {
                        select: { id: true, name: true, email: true, role: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    return (
      <AppShell header={<PageHeaderSkeleton />}>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          项目不存在或无权限访问。
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell header={<PageHeader projectName={project.name} />}>
      <Suspense fallback={<div className="animate-pulse rounded-lg border border-ink-100 bg-white p-6 text-sm text-ink-400">加载中…</div>}>
        <ProjectDetail project={project as unknown as ProjectWithStatus} />
      </Suspense>
    </AppShell>
  );
}
