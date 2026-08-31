import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession, requireProjectEditor } from "@/shared/lib/permissions";
import { sha256Hex } from "@/shared/lib/hash";
import { recordFileReference } from "@/features/knowledge/lib/file-reference";
import { enqueueBackgroundJob } from "@/worker/background/jobs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/[id]/meetings
 * 获取项目的周会列表
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id: projectId } = await params;
    await requireSession();

    const meetings = await prisma.projectMeeting.findMany({
      where: { projectId },
      orderBy: { meetingDate: "desc" },
      include: {
        creator: {
          select: { id: true, name: true, email: true, image: true },
        },
        audioFileAsset: {
          select: { id: true, originalName: true, size: true, mimeType: true },
        },
      },
    });

    return NextResponse.json({ data: meetings });
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
 * POST /api/projects/[id]/meetings
 * 创建新周会并上传音频（支持 multipart/form-data 或 json 传 audioFileAssetId）
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: projectId } = await params;
    const session = await requireProjectEditor(projectId);
    const userId = session.user.id;

    let title = "";
    let meetingDateStr = "";
    let audioFileAssetId: string | null = null;
    let audioDuration: number | null = null;

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      title = (formData.get("title") as string) || "";
      meetingDateStr = (formData.get("meetingDate") as string) || "";
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { error: "请上传音频文件 (.mp3, .wav, .m4a)" },
          { status: 400 },
        );
      }

      // 验证音频格式与大小 (上限 100MB)
      const allowedExts = [".mp3", ".wav", ".m4a", ".webm", ".mp4"];
      const lowerName = file.name.toLowerCase();
      const isValidExt = allowedExts.some((ext) => lowerName.endsWith(ext));
      if (!isValidExt && !file.type.startsWith("audio/")) {
        return NextResponse.json(
          { error: "仅支持 .mp3, .wav, .m4a 格式音频" },
          { status: 400 },
        );
      }

      if (file.size > 100 * 1024 * 1024) {
        return NextResponse.json(
          { error: "音频文件大小不能超过 100MB" },
          { status: 400 },
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const hash = sha256Hex(bytes);

      // 上传音频写入 FileAsset（若已存在同 hash+size 则复用，避免 upsert 依赖 ON CONFLICT 约束）
      let fileAsset = await prisma.fileAsset.findFirst({
        where: { hash, size: file.size, status: "ACTIVE" },
      });
      if (!fileAsset) {
        fileAsset = await prisma.fileAsset.create({
          data: {
            uploaderId: userId,
            originalName: file.name,
            mimeType: file.type || "audio/mpeg",
            size: file.size,
            bytes,
            hash,
            status: "ACTIVE",
          },
        });
      }
      audioFileAssetId = fileAsset.id;
    } else {
      const body = await request.json();
      title = body.title || "";
      meetingDateStr = body.meetingDate || "";
      audioFileAssetId = body.audioFileAssetId || null;
      audioDuration =
        typeof body.audioDuration === "number" ? body.audioDuration : null;
    }

    if (!title.trim()) {
      return NextResponse.json({ error: "周会主题不能为空" }, { status: 400 });
    }

    const meetingDate = meetingDateStr ? new Date(meetingDateStr) : new Date();
    if (isNaN(meetingDate.getTime())) {
      return NextResponse.json({ error: "非法的会议日期" }, { status: 400 });
    }

    if (!audioFileAssetId) {
      return NextResponse.json(
        { error: "必须关联或上传会议音频文件" },
        { status: 400 },
      );
    }

    // 创建 ProjectMeeting 与 FileReference 记录
    const meeting = await prisma.projectMeeting.create({
      data: {
        projectId,
        creatorId: userId,
        title: title.trim(),
        meetingDate,
        audioFileAssetId,
        audioDuration,
        status: "TRANSCRIBING",
      },
    });

    try {
      await prisma.fileReference.upsert({
        where: {
          fileAssetId_sourceType_sourceId: {
            fileAssetId: audioFileAssetId,
            sourceType: "PROJECT_MEETING",
            sourceId: meeting.id,
          },
        },
        create: {
          fileAssetId: audioFileAssetId,
          sourceType: "PROJECT_MEETING",
          sourceId: meeting.id,
        },
        update: {
          deletedAt: null,
        },
      });
    } catch (refErr) {
      console.warn("[MEETINGS] recordFileReference failed:", refErr);
    }
    // 投递 BackgroundJob 异步执行语音转录与 AI 7 要素生成
    await enqueueBackgroundJob({
      type: "MEETING_PROCESS",
      payload: {
        meetingId: meeting.id,
        step: "ALL",
      },
    });

    return NextResponse.json({ data: meeting });
  } catch (error) {
    console.error("[POST /api/projects/[id]/meetings ERROR]:", error);
    const msg = error instanceof Error ? error.message : "Internal error";
    if (msg === "UNAUTHORIZED")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Forbidden: 您不是该项目成员或没有编辑权限" }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
}
}
