import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireProjectEditor } from "@/shared/lib/permissions";
import { sha256Hex } from "@/shared/lib/hash";
import { enqueueIndexJob } from "@/worker/lib/jobs";
import {
  renderMeetingSummaryMarkdown,
  type MeetingSummaryData,
  parseAndValidateSummaryJson,
} from "@/features/ai/llm/meeting-summarizer";

type RouteParams = { params: Promise<{ id: string; meetingId: string }> };

/**
 * POST /api/projects/[id]/meetings/[meetingId]/publish
 * 专员确认发布周会纪要：
 * 1. 固化 draftSummary 为正式 Markdown
 * 2. 创建 FileAsset 与正式 Document
 * 3. 关联项目 FileReference 并投递 IndexJob 进行向量化/RAG 索引
 * 4. 更新 ProjectMeeting 状态为 PUBLISHED
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { id: projectId, meetingId } = await params;
    const session = await requireProjectEditor(projectId);
    const userId = session.user.id;

    const meeting = await prisma.projectMeeting.findUnique({
      where: { id: meetingId },
    });

    if (!meeting || meeting.projectId !== projectId) {
      return NextResponse.json({ error: "周会记录不存在" }, { status: 404 });
    }

    if (meeting.status === "PUBLISHED") {
      return NextResponse.json(
        { error: "该周会已处于发布状态" },
        { status: 400 },
      );
    }

    // 提取草稿或 AI 总结数据
    const rawData = (meeting.draftSummary || meeting.aiSummary) as unknown;
    let summaryData: MeetingSummaryData;

    if (rawData && typeof rawData === "object") {
      // SAFETY: draftSummary / aiSummary was validated as MeetingSummaryData schema before saving
      summaryData = rawData as MeetingSummaryData;
    } else if (typeof rawData === "string") {
      summaryData = parseAndValidateSummaryJson(
        rawData,
        meeting.rawTranscript || "",
      );
    } else {
      return NextResponse.json(
        { error: "会议纪要内容为空，无法发布" },
        { status: 400 },
      );
    }

    // 渲染为优雅 Markdown
    const markdownContent = renderMeetingSummaryMarkdown(
      meeting.title,
      meeting.meetingDate,
      summaryData,
    );

    const bytes = Buffer.from(markdownContent, "utf-8");
    const hash = sha256Hex(bytes);
    const fileName = `[周会纪要] ${meeting.title}.md`;

    // 1. 创建正式 Markdown 的 FileAsset
    const fileAsset = await prisma.fileAsset.create({
      data: {
        uploaderId: userId,
        originalName: fileName,
        mimeType: "text/markdown",
        size: bytes.length,
        bytes,
        hash,
        status: "ACTIVE",
      },
    });

    // 2. 创建 1:1 派生的 Document 实体
    await prisma.document.create({
      data: {
        fileAssetId: fileAsset.id,
        status: "PENDING",
        extractedText: markdownContent,
        metadata: {
          source: "PROJECT_MEETING",
          meetingId: meeting.id,
          meetingTitle: meeting.title,
          meetingDate: meeting.meetingDate.toISOString(),
        },
      },
    });

    // 3. 记录项目级文件引用 (使其挂载在项目文档列表中)
    try {
      await prisma.fileReference.upsert({
        where: {
          fileAssetId_sourceType_sourceId: {
            fileAssetId: fileAsset.id,
            sourceType: "PROJECT",
            sourceId: projectId,
          },
        },
        create: {
          fileAssetId: fileAsset.id,
          sourceType: "PROJECT",
          sourceId: projectId,
        },
        update: {
          deletedAt: null,
        },
      });
    } catch (refErr) {
      console.warn("[MEETING_PUBLISH] recordFileReference failed:", refErr);
    }

    // 4. 更新 ProjectMeeting
    const publishedMeeting = await prisma.projectMeeting.update({
      where: { id: meeting.id },
      data: {
        status: "PUBLISHED",
        publishedSummary: markdownContent,
        documentFileAssetId: fileAsset.id,
        publishedAt: new Date(),
        errorMessage: null,
        failedStep: null,
      },
    });

    // 投递 IndexJob 触发文本切片、Embedding 生成并写入 SearchDocument (RAG)
    try {
      await enqueueIndexJob({
        targetType: "FILE_ASSET",
        targetId: fileAsset.id,
      });
    } catch (jobErr) {
      console.error(
        "[MEETING_PUBLISH] 投递 IndexJob 失败（不阻断发布流程）:",
        jobErr,
      );
    }

    return NextResponse.json({
      data: {
        meeting: publishedMeeting,
        documentFileAssetId: fileAsset.id,
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
