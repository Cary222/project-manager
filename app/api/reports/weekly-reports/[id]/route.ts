import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getWeeklyReport, updateWeeklyReport, deleteWeeklyReport } from "@/features/weekly-reports/lib/weekly-report-store";
import { enqueueSummarizeWeeklyReport } from "@/features/reports/weekly-reports/lib/background-jobs";
import { prisma } from "@/shared/db/client";

const updateSchema = z.object({
  weekStart: z.string().datetime().optional(),
  weekEnd: z.string().datetime().optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  attachments: z.array(z.object({
    fileId: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  })).optional(),
  projectIds: z.array(z.string()).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const report = await getWeeklyReport(id, session.user.id);
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ report });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    const input: Parameters<typeof updateWeeklyReport>[2] = {};
    if (data.title !== undefined) input.title = data.title;
    if (data.content !== undefined) input.content = data.content;
    if (data.attachments !== undefined) input.attachments = data.attachments;
    if (data.projectIds !== undefined) input.projectIds = data.projectIds;

    const report = await updateWeeklyReport(id, session.user.id, input);

    // fire-and-forget: 内容变更后触发画像刷新（依赖 enqueueUpdateProfile 去重）
    void enqueueSummarizeWeeklyReport(id);

    return NextResponse.json({ report }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // 获取周报信息（用于清理工作流关联）
  const report = await prisma.weeklyReport.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, workflowRunId: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 事务：删除周报 + 清理关联工作流的 metadata.reportId
  await prisma.$transaction(async (tx) => {
    // 1. 删除周报关联的项目记录
    await tx.weeklyReportProject.deleteMany({ where: { reportId: id } });

    // 2. 删除周报
    await tx.weeklyReport.delete({ where: { id } });

    // 3. 清理关联 WorkflowRun 的 metadata.reportId
    // 使用 raw query 直接操作 JSON 字段，清除 reportId
    if (report.workflowRunId) {
      await tx.$executeRaw`
        UPDATE "pm"."WorkflowRun"
        SET metadata = metadata #- '{reportId}',
            "updatedAt" = NOW()
        WHERE id = ${report.workflowRunId}
          AND metadata IS NOT NULL
          AND metadata::text LIKE '%reportId%'
      `.catch(() => {
        // 忽略错误（某些情况下 metadata 可能为 null 或格式不对）
      });
    }

    // 4. 查找并清理所有通过 workflowRunId 关联到该报告的工作流
    await tx.workflowRun.updateMany({
      where: {
        metadata: {
          path: ["reportId"],
          equals: id,
        } as never,
      },
      data: {
        status: "cancelled",
      },
    }).catch(() => {
      // 忽略 JSON path 查询的错误
    });
  });

  return new NextResponse(null, { status: 204 });
}
