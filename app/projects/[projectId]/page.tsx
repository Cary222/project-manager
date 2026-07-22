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

  // 获取该项目下所有 ticket 的 ID
  const ticketIds = project.responsibilities
    .flatMap((r) => r.modules)
    .flatMap((m) => m.tickets)
    .map((t) => t.id);

  // 获取所有 ticket 的附件（通过 FileReference）
  const ticketAttachments = await prisma.fileReference.findMany({
    where: {
      sourceType: "TICKET",
      sourceId: { in: ticketIds },
      deletedAt: null,
    },
    include: {
      fileAsset: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          size: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 获取项目直接上传的附件（sourceType="PROJECT"）
  const projectAttachments = await prisma.fileReference.findMany({
    where: {
      sourceType: "PROJECT",
      sourceId: projectId,
      deletedAt: null,
    },
    include: {
      fileAsset: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          size: true,
          createdAt: true,
          uploader: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 构建 ticket 附件数据供 ProjectDetail 使用
  const projectWithTicketAttachments = {
    ...(project as unknown as ProjectWithStatus),
    ticketAttachments: ticketAttachments.map((ref) => ({
      ticketId: ref.sourceId,
      fileId: ref.fileAssetId,
      name: ref.fileAsset.originalName,
      mimeType: ref.fileAsset.mimeType,
      size: ref.fileAsset.size,
      createdAt: ref.createdAt.toISOString(),
    })),
    projectAttachments: projectAttachments.map((ref) => ({
      fileId: ref.fileAssetId,
      name: ref.fileAsset.originalName,
      mimeType: ref.fileAsset.mimeType,
      size: ref.fileAsset.size,
      uploader: ref.fileAsset.uploader.name ?? "—",
      createdAt: ref.createdAt.toISOString(),
    })),
  };

  return (
    <AppShell header={<PageHeader projectName={project.name} />}>
      <Suspense fallback={<div className="animate-pulse rounded-lg border border-ink-100 bg-white p-6 text-sm text-ink-400">加载中…</div>}>
        <ProjectDetail project={projectWithTicketAttachments as unknown as ProjectWithStatus} />
      </Suspense>
    </AppShell>
  );
}
