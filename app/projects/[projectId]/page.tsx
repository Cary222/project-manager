import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";
import { AppShell } from "@/components/AppShell";
import {
  PageHeader,
  PageHeaderSkeleton,
  type ProjectWithStatus,
} from "@/components/project/ProjectDetail";
import { ProjectDetail } from "@/components/project/ProjectDetail";

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
      <ProjectDetail project={project as unknown as ProjectWithStatus} />
    </AppShell>
  );
}
