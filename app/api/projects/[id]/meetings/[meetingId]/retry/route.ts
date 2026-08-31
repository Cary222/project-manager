import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireProjectEditor } from "@/shared/lib/permissions";
import { enqueueBackgroundJob } from "@/worker/background/jobs";

type RouteParams = { params: Promise<{ id: string; meetingId: string }> };

/**
 * POST /api/projects/[id]/meetings/[meetingId]/retry
 * 失败重试或重新生成周会纪要
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: projectId, meetingId } = await params;
    await requireProjectEditor(projectId);

    const meeting = await prisma.projectMeeting.findUnique({
      where: { id: meetingId },
    });

    if (!meeting || meeting.projectId !== projectId) {
      return NextResponse.json({ error: "周会记录不存在" }, { status: 404 });
    }

    if (meeting.status === "PUBLISHED") {
      return NextResponse.json(
        { error: "该周会已发布，无法重试" },
        { status: 400 },
      );
    }

    let customStep: "ALL" | "TRANSCRIBE" | "SUMMARIZE" | undefined;
    try {
      const body = await request.json().catch(() => ({}));
      if (["ALL", "TRANSCRIBE", "SUMMARIZE"].includes(body?.step)) {
        customStep = body.step;
      }
    } catch {
      // 允许空 body
    }

    // 智能决定执行阶段
    let stepToRun: "ALL" | "TRANSCRIBE" | "SUMMARIZE" = "ALL";
    if (customStep) {
      stepToRun = customStep;
    } else if (meeting.failedStep === "SUMMARIZE" && meeting.rawTranscript) {
      stepToRun = "SUMMARIZE";
    }

    const nextStatus =
      stepToRun === "SUMMARIZE" ? "SUMMARIZING" : "TRANSCRIBING";

    const updated = await prisma.projectMeeting.update({
      where: { id: meetingId },
      data: {
        status: nextStatus,
        errorMessage: null,
        failedStep: null,
      },
    });

    await enqueueBackgroundJob({
      type: "MEETING_PROCESS",
      payload: {
        meetingId,
        step: stepToRun,
      },
    });

    return NextResponse.json({
      data: {
        meeting: updated,
        retryingStep: stepToRun,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
