/**
 * POST /api/reports/weekly-reports/generate-from-workflow
 *
 * Called after user approves in ChatReviewPanel.
 * Upserts the weekly report (title/week/content from prefill),
 * then cancels the workflow run so it doesn't auto-output.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";
import { enqueueSummarizeWeeklyReport } from "@/features/reports/weekly-reports/lib/background-jobs";

const bodySchema = z.object({
  workflowRunId: z.string().min(1),
  weekStart: z.string().datetime(),
  weekEnd: z.string().datetime(),
  title: z.string().min(1).max(200),
  content: z.string(),
  projectIds: z.array(z.string()).optional(),
  /** 项目名称列表，用于自动匹配 projectIds */
  projectNames: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = bodySchema.parse(body);

    const weekStart = new Date(data.weekStart);
    const weekEnd = new Date(data.weekEnd);

    // Resolve projectIds: use provided ones, or match by projectNames
    let resolvedProjectIds: string[] | undefined = data.projectIds;
    if (!resolvedProjectIds && data.projectNames?.length) {
      const projects = await prisma.project.findMany({
        where: { name: { in: data.projectNames } },
        select: { id: true },
      });
      resolvedProjectIds = projects.map((p) => p.id);
    }

    // 1) Upsert weekly report (idempotent by userId+weekStart)
    const existing = await prisma.weeklyReport.findUnique({
      where: {
        userId_weekStart: {
          userId: session.user.id,
          weekStart,
        },
      },
      select: { id: true },
    });

    let reportId: string;

    if (existing) {
      const updated = await prisma.weeklyReport.update({
        where: { id: existing.id },
        data: {
          title: data.title,
          content: data.content,
          weekEnd,
          workflowRunId: data.workflowRunId,
          ...(resolvedProjectIds?.length
            ? { projects: { set: resolvedProjectIds.map((id) => ({ id })) } }
            : {}),
        },
        select: { id: true },
      });
      reportId = updated.id;
    } else {
      const created = await prisma.weeklyReport.create({
        data: {
          userId: session.user.id,
          weekStart,
          weekEnd,
          title: data.title,
          content: data.content,
          workflowRunId: data.workflowRunId,
          ...(resolvedProjectIds?.length
            ? { projects: { connect: resolvedProjectIds.map((id) => ({ id })) } }
            : {}),
        },
        select: { id: true },
      });
      reportId = created.id;
    }

    // 2) Cancel the workflow run so it doesn't auto-output again
    await prisma.workflowRun.updateMany({
      where: { id: data.workflowRunId, userId: session.user.id },
      data: { status: "cancelled" },
    });

    // 3) Fire-and-forget AI profile update
    void enqueueSummarizeWeeklyReport(reportId);

    return NextResponse.json({ reportId }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
