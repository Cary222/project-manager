import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { isWorkOrchestratorEnabled } from "@/features/ai/pi-integration/feature-flags";
import { listWorkRunRefs } from "@/features/ai/agents/work/runtime/work-run-projection";
import { prisma } from "@/shared/db/client";

export const dynamic = "force-dynamic";

/** Read-model endpoint: Work reloads durable records rather than memory runs. */
export async function GET() {
  try {
    const session = await requireSession();
    if (!isWorkOrchestratorEnabled()) {
      return NextResponse.json({ enabled: false, data: [] });
    }
    return NextResponse.json({
      enabled: true,
      data: await listWorkRunRefs(session.user.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}

/** 一键删除指定工作流或任务及其关联产物 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const sourceId = searchParams.get("sourceId");

    if (!source || !sourceId) {
      return NextResponse.json(
        { error: "缺少 source 或 sourceId 参数" },
        { status: 400 },
      );
    }

    if (source === "WorkflowRun") {
      const run = await prisma.workflowRun.findFirst({
        where: { id: sourceId, userId: session.user.id },
      });
      if (run) {
        // 1. 如果关联周报产物，一并级联清理
        const reportId = (run.metadata as Record<string, unknown> | null)
          ?.reportId as string | undefined;
        if (reportId) {
          await prisma.weeklyReport.deleteMany({
            where: { id: reportId, userId: session.user.id },
          });
        }
        await prisma.weeklyReport.deleteMany({
          where: { workflowRunId: sourceId, userId: session.user.id },
        });

        // 2. 删除工作流运行记录
        await prisma.workflowRun.delete({ where: { id: sourceId } });
      }
    } else if (source === "PiSessionOwnership") {
      // 软删除 Pi Session 归属
      await prisma.piSessionOwnership.updateMany({
        where: { piSessionId: sourceId, userId: session.user.id },
        data: { deletedAt: new Date() },
      });
    } else if (source === "ProjectMeeting") {
      // 会议纪要删除
      const meeting = await prisma.projectMeeting.findFirst({
        where: {
          id: sourceId,
          project: { members: { some: { userId: session.user.id } } },
        },
      });
      if (meeting) {
        await prisma.projectMeeting.delete({ where: { id: sourceId } });
      }
    }

    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}
