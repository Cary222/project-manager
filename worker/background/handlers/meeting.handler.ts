import { prisma } from "@/shared/db/client";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { updateBackgroundJobStatus } from "../jobs";
import {
  transcribeWithDashScope,
  inferFormatFromMimeType,
} from "@/features/ai/llm/providers/audio/stt/dashscope";
import {
  getWeeklyReportsForMeeting,
  generateMeetingSummaryFromTranscript,
} from "@/features/ai/llm/meeting-summarizer";

interface MeetingJobPayload {
  meetingId: string;
  step?: "ALL" | "TRANSCRIBE" | "SUMMARIZE";
}

export async function handleMeetingProcess(
  job: BackgroundJob,
  _workerId: string,
): Promise<void> {
  // SAFETY: BackgroundJob.payload contains JSON object configured by enqueueBackgroundJob
  const payload = job.payload as unknown as MeetingJobPayload | null;
  const meetingId = payload?.meetingId;
  const step = payload?.step || "ALL";

  if (!meetingId) {
    throw new Error(`[MEETING_PROCESS] Invalid job payload: missing meetingId`);
  }

  const meeting = await prisma.projectMeeting.findUnique({
    where: { id: meetingId },
    include: {
      audioFileAsset: true,
      project: { select: { id: true, name: true } },
    },
  });

  if (!meeting) {
    throw new Error(`[MEETING_PROCESS] ProjectMeeting not found: ${meetingId}`);
  }

  let currentStep: "TRANSCRIBE" | "SUMMARIZE" = "TRANSCRIBE";
  let transcript = meeting.rawTranscript || "";

  try {
    // 阶段 1: 语音转文字 (ASR)
    const shouldTranscribe =
      step === "ALL" || step === "TRANSCRIBE" || !transcript;

    if (shouldTranscribe) {
      if (!meeting.audioFileAsset) {
        throw new Error("周会未关联音频文件，无法执行语音转录");
      }

      currentStep = "TRANSCRIBE";
      console.log(
        `[MEETING_PROCESS] 开始音频转录: meetingId=${meetingId}, audioId=${meeting.audioFileAsset.id}`,
      );

      await prisma.projectMeeting.update({
        where: { id: meetingId },
        data: {
          status: "TRANSCRIBING",
          errorMessage: null,
          failedStep: null,
        },
      });

      const audioBuffer = Buffer.from(meeting.audioFileAsset.bytes);
      const format = inferFormatFromMimeType(
        meeting.audioFileAsset.mimeType,
        meeting.audioFileAsset.originalName,
      );

      const sttResult = await transcribeWithDashScope(audioBuffer, format, {
        userId: meeting.creatorId,
      });

      transcript = sttResult.text?.trim() || "";
      if (!transcript) {
        throw new Error("语音识别返回内容为空，请检查音频音质或格式");
      }

      const duration = sttResult.duration
        ? Math.round(sttResult.duration)
        : meeting.audioDuration;

      await prisma.projectMeeting.update({
        where: { id: meetingId },
        data: {
          rawTranscript: transcript,
          audioDuration: duration,
        },
      });
      console.log(`[MEETING_PROCESS] 音频转录完成，字数: ${transcript.length}`);
    }

    // 阶段 2: AI 结构化 7 要素提取 (LLM)
    currentStep = "SUMMARIZE";
    console.log(
      `[MEETING_PROCESS] 开始 AI 结构化纪要生成: meetingId=${meetingId}`,
    );

    await prisma.projectMeeting.update({
      where: { id: meetingId },
      data: {
        status: "SUMMARIZING",
        errorMessage: null,
        failedStep: null,
      },
    });

    // 检索该周项目成员周报作为参考
    const { reports: weeklyReports, reportIds } =
      await getWeeklyReportsForMeeting(meeting.projectId, meeting.meetingDate);

    console.log(
      `[MEETING_PROCESS] 检索到当周成员周报: ${weeklyReports.length} 篇`,
    );

    const summaryData = await generateMeetingSummaryFromTranscript({
      userId: meeting.creatorId,
      meetingTitle: meeting.title,
      meetingDate: meeting.meetingDate,
      transcript,
      weeklyReports,
    });

    // 保存 AI 原始结果和初始草稿
    await prisma.projectMeeting.update({
      where: { id: meetingId },
      data: {
        // SAFETY: summaryData is validated MeetingSummaryData plain JSON object
        aiSummary: JSON.parse(JSON.stringify(summaryData)) as Prisma.InputJsonValue,
        // SAFETY: draftSummary preserves user edits or initializes to summaryData JSON
        draftSummary: JSON.parse(JSON.stringify(meeting.draftSummary || summaryData)) as Prisma.InputJsonValue,
        includedWeeklyReportIds: reportIds,
        status: "PENDING_REVIEW",
        errorMessage: null,
        failedStep: null,
      },
    });

    console.log(
      `[MEETING_PROCESS] 会议纪要生成成功，流转至待审核: meetingId=${meetingId}`,
    );

    await updateBackgroundJobStatus(job.id, "COMPLETED", {
      result: {
        meetingId,
        transcriptLength: transcript.length,
        reportsIncluded: reportIds.length,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[MEETING_PROCESS] 处理失败 (step=${currentStep}):`,
      errorMsg,
    );

    // 标记会议状态为 FAILED
    await prisma.projectMeeting.update({
      where: { id: meetingId },
      data: {
        status: "FAILED",
        failedStep: currentStep,
        errorMessage: errorMsg,
      },
    });

    await updateBackgroundJobStatus(job.id, "FAILED", {
      errorMessage: `[${currentStep}] ${errorMsg}`,
    });

    throw error;
  }
}
