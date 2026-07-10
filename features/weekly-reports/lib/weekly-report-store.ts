import { prisma } from "@/shared/db/client";
import type { WeeklyReport } from "@prisma/client";
import type { FileAttachment } from "@/shared/lib/pkm";

export type WeeklyReportWithProjects = WeeklyReport & {
  projects: { id: string; name: string }[];
};

export async function listMyWeeklyReports(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<WeeklyReportWithProjects[]> {
  const reports = await prisma.weeklyReport.findMany({
    where: { userId },
    take: (opts?.limit ?? 20) + 1,
    ...(opts?.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    orderBy: { weekStart: "desc" },
    include: {
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  const mapped: WeeklyReportWithProjects[] = reports.map((r) => ({
    ...r,
    projects: r.projects.map((rp) => ({ id: rp.project.id, name: rp.project.name })),
  }));

  return opts?.cursor ? mapped.slice(0, -1) : mapped;
}

/**
 * 查询他人周报（只读，不检查 userId 权限）
 * 用于团队成员页面展示他人周报
 */
export async function listUserWeeklyReports(
  targetUserId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<WeeklyReportWithProjects[]> {
  const reports = await prisma.weeklyReport.findMany({
    where: { userId: targetUserId },
    take: (opts?.limit ?? 20) + 1,
    ...(opts?.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    orderBy: { weekStart: "desc" },
    include: {
      projects: { include: { project: { select: { id: true, name: true } } } },
      user: { select: { name: true, email: true } },
    },
  });

  const mapped: (WeeklyReportWithProjects & { user?: { name: string | null; email: string } })[] = reports.map((r) => ({
    ...r,
    projects: r.projects.map((rp) => ({ id: rp.project.id, name: rp.project.name })),
  }));

  return opts?.cursor ? mapped.slice(0, -1) as WeeklyReportWithProjects[] : mapped as WeeklyReportWithProjects[];
}

export async function getWeeklyReport(
  id: string,
  userId: string,
): Promise<WeeklyReportWithProjects | null> {
  const report = await prisma.weeklyReport.findFirst({
    where: { id, userId },
    include: {
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });
  if (!report) return null;
  return {
    ...report,
    projects: report.projects.map((rp) => ({ id: rp.project.id, name: rp.project.name })),
  };
}

/**
 * 只读查询周报详情（不检查 userId 权限）
 * 用于查看他人周报
 */
export async function getUserWeeklyReport(id: string): Promise<(WeeklyReportWithProjects & { user?: { name: string | null; email: string } }) | null> {
  const report = await prisma.weeklyReport.findUnique({
    where: { id },
    include: {
      projects: { include: { project: { select: { id: true, name: true } } } },
      user: { select: { name: true, email: true } },
    },
  });
  if (!report) return null;
  return {
    ...report,
    projects: report.projects.map((rp) => ({ id: rp.project.id, name: rp.project.name })),
  };
}

export async function createWeeklyReport(
  userId: string,
  input: {
    weekStart: Date;
    weekEnd: Date;
    title: string;
    content: string;
    attachments?: FileAttachment[] | unknown;
    projectIds?: string[];
  },
): Promise<WeeklyReportWithProjects> {
  // Normalize to FileAttachment[] only if it's an old-format array (contains url without fileId)
  let attachments: FileAttachment[] = [];
  if (Array.isArray(input.attachments)) {
    attachments = (input.attachments as FileAttachment[]).filter(
      (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
    );
  }

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.weeklyReport.create({
      data: {
        userId,
        weekStart: input.weekStart,
        weekEnd: input.weekEnd,
        title: input.title,
        content: input.content,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
    });

    if (input.projectIds && input.projectIds.length > 0) {
      await tx.weeklyReportProject.createMany({
        data: input.projectIds.map((projectId) => ({
          reportId: created.id,
          projectId,
        })),
      });
    }

    return created;
  });

  const withProjects = await prisma.weeklyReport.findUnique({
    where: { id: report.id },
    include: {
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  return {
    ...withProjects!,
    projects: withProjects!.projects.map((rp) => ({ id: rp.project.id, name: rp.project.name })),
  };
}

export async function updateWeeklyReport(
  id: string,
  userId: string,
  input: Partial<{
    title: string;
    content: string;
    attachments: FileAttachment[] | unknown;
    projectIds: string[];
  }>,
): Promise<WeeklyReportWithProjects> {
  let attachments: FileAttachment[] | undefined;
  if (input.attachments !== undefined) {
    if (Array.isArray(input.attachments)) {
      attachments = (input.attachments as FileAttachment[]).filter(
        (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
      );
    } else {
      attachments = undefined;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.weeklyReport.findFirst({ where: { id, userId } });
    if (!existing) throw new Error("NOT_FOUND");

    const data: Parameters<typeof tx.weeklyReport.update>[0]["data"] = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.content = input.content;
    if (attachments !== undefined) data.attachments = attachments.length > 0 ? attachments : undefined;

    const result = await tx.weeklyReport.update({
      where: { id },
      data,
    });

    if (input.projectIds !== undefined) {
      await tx.weeklyReportProject.deleteMany({ where: { reportId: id } });
      if (input.projectIds.length > 0) {
        await tx.weeklyReportProject.createMany({
          data: input.projectIds.map((projectId) => ({ reportId: id, projectId })),
        });
      }
    }

    return result;
  });

  const withProjects = await prisma.weeklyReport.findUnique({
    where: { id: updated.id },
    include: {
      projects: { include: { project: { select: { id: true, name: true } } } },
    },
  });

  return {
    ...withProjects!,
    projects: withProjects!.projects.map((rp) => ({ id: rp.project.id, name: rp.project.name })),
  };
}

export async function deleteWeeklyReport(id: string, userId: string): Promise<void> {
  await prisma.weeklyReport.deleteMany({ where: { id, userId } });
}
