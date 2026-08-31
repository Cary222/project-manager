import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession, requireProjectEditor } from "@/shared/lib/permissions";
import type { Prisma } from "@prisma/client";

type RouteParams = { params: Promise<{ id: string; meetingId: string }> };

/**
 * GET /api/projects/[id]/meetings/[meetingId]
 * 获取周会完整详情（含原始转录、AI 7 要素、草稿、发布内容）
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id: projectId, meetingId } = await params;
    await requireSession();

    const meeting = await prisma.projectMeeting.findUnique({
      where: { id: meetingId },
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        audioFileAsset: {
          select: { id: true, originalName: true, size: true, mimeType: true },
        },
        documentFileAsset: {
          select: { id: true, originalName: true, size: true, mimeType: true },
        },
      },
    });

    if (!meeting || meeting.projectId !== projectId) {
      return NextResponse.json({ error: "周会记录不存在" }, { status: 404 });
    }

    return NextResponse.json({ data: meeting });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/projects/[id]/meetings/[meetingId]
 * 保存周会草稿或修改标题/日期（禁止直接覆盖 AI 原始内容）
 */
export async function PATCH(request: Request, { params }: RouteParams) {
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
        { error: "该周会已正式发布，无法直接修改草稿" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const updateData: {
      title?: string;
      meetingDate?: Date;
      draftSummary?: Prisma.InputJsonValue;
    } = {};

    if (typeof body.title === "string" && body.title.trim()) {
      updateData.title = body.title.trim();
    }

    if (body.meetingDate) {
      const parsedDate = new Date(body.meetingDate);
      if (!isNaN(parsedDate.getTime())) {
        updateData.meetingDate = parsedDate;
      }
    }

    if (body.draftSummary && typeof body.draftSummary === "object") {
      // SAFETY: draftSummary contains user edits structured in compliance with JSON format
      updateData.draftSummary = body.draftSummary as Prisma.InputJsonValue;
    }

    const updated = await prisma.projectMeeting.update({
      where: { id: meetingId },
      data: updateData,
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        audioFileAsset: {
          select: { id: true, originalName: true, size: true, mimeType: true },
        },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
