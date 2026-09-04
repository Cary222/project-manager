import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";

type RouteParams = { params: Promise<{ meetingId: string }> };

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/work/meetings/[meetingId]
 * 在 Work 模式下直接根据 meetingId 读取会议详情（自动校验当前用户权限）
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireSession();
    const { meetingId } = await params;

    const meeting = await prisma.projectMeeting.findUnique({
      where: { id: meetingId },
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        project: {
          select: { id: true, name: true, ownerId: true },
        },
        audioFileAsset: {
          select: { id: true, originalName: true, size: true, mimeType: true },
        },
        documentFileAsset: {
          select: { id: true, originalName: true, size: true, mimeType: true },
        },
      },
    });

    if (!meeting) {
      return NextResponse.json(
        { error: "会议纪要记录不存在" },
        { status: 404 },
      );
    }

    // 校验权限：是创建者、项目拥有者或项目成员
    const isCreator = meeting.creatorId === session.user.id;
    const isOwner = meeting.project?.ownerId === session.user.id;
    const isMember = await prisma.userOnProject.findFirst({
      where: { projectId: meeting.projectId, userId: session.user.id },
    });

    if (!isCreator && !isOwner && !isMember) {
      return NextResponse.json(
        { error: "无权访问此会议纪要" },
        { status: 403 },
      );
    }

    return NextResponse.json({ data: meeting });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}
