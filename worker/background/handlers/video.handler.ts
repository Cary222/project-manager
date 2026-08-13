import { prisma } from "@/shared/db/client";
import type { BackgroundJob } from "@prisma/client";
import { updateBackgroundJobStatus } from "../jobs";
import { emitMessageDelta } from "@/features/ai/lib/domain-events";
import { generateVideos } from "@/features/ai/llm/video-generator";
import { saveVideoAsset } from "@/features/ai/llm/video-providers/storage";
import { resolveCredentialWithFallback } from "@/features/ai/llm/credentials/api-key-store";
import { resolveProviderImageSource } from "@/features/ai/lib/file-source";
import { resolveGenerationMode } from "@/features/ai/routing/generation-mode";

interface VideoPayload {
  messageId: string;
  userId: string;
  prompt: string;
  modelRef?: string;
  /** 输入图片文件 ID 数组（I2V 模式） */
  inputFileIds?: string[];
  /** 存储已完成的 Agnes task_id，避免重复提交 */
  agnesTaskId?: string;
}

/** 解析视频生成 API Key — 从 DB SYSTEM/USER provider 读取 */
async function resolveVideoApiKey(
  userId: string,
  modelRef: string
): Promise<{ apiKey: string; baseURL: string } | null> {
  const [provider] = modelRef.includes(":") ? modelRef.split(":") : ["agnes", modelRef];

  const cred = await resolveCredentialWithFallback(userId, provider);
  if (cred?.apiKey) {
    return { apiKey: cred.apiKey, baseURL: cred.baseURL };
  }

  return null;
}

export async function handleVideoGenerate(
  job: BackgroundJob,
  _workerId: string,
): Promise<void> {
  const {
    messageId,
    userId,
    prompt,
    modelRef = "agnes:agnes-video-v2.0",
    inputFileIds,
    agnesTaskId: existingTaskId,
  } = job.payload as unknown as VideoPayload;
  const startTime = Date.now();

  // 计算生成模式（T2V vs I2V）
  const generationMode = resolveGenerationMode("video", inputFileIds);
  console.log(`[VIDEO_GENERATE] job=${job.id} mode=${generationMode} model=${modelRef}`);

  // I2V 模式：解析输入图片为 Provider 可访问的 URL
  let inputImageUrl: string | undefined;
  if (generationMode === "IMAGE_TO_VIDEO" && inputFileIds) {
    try {
      // 第一版限制：只取第一张图片
      const source = await resolveProviderImageSource(inputFileIds[0]);
      inputImageUrl = source.url;
      console.log(`[VIDEO_GENERATE] I2V mode: input image resolved to ${inputImageUrl}`);
    } catch (error) {
      // 文件解析失败（DATABASE storage 等）
      console.error(`[VIDEO_GENERATE] Failed to resolve input image:`, error);
      await prisma.aiChatMessage.update({
        where: { id: messageId },
        data: {
          executionStatus: "FAILED",
          content: "输入图片无法访问，请使用外部图片链接。",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      emitMessageDelta(messageId, { executionStatus: "FAILED" });
      throw error;
    }
  }

  const credential = await resolveVideoApiKey(userId, modelRef);
  console.log(
    `[video-handler] userId=${userId} modelRef=${modelRef} existingTaskId=${existingTaskId ?? "none"} generationMode=${generationMode} credential=`,
    credential
      ? `{ apiKey: ${credential.apiKey.substring(0, 10)}..., baseURL: ${credential.baseURL} }`
      : null
  );

  if (!credential) {
    const msg = `视频生成模型 ${modelRef} 的 API Key 未配置，请在设置中添加对应 provider 的 API Key`;
    console.error(`[video-handler] ${msg}`);
    await prisma.aiChatMessage.update({
      where: { id: messageId },
      data: { executionStatus: "FAILED", errorMessage: msg },
    });
    await updateBackgroundJobStatus(job.id, "FAILED", { errorMessage: msg });
    return;
  }

  await prisma.aiChatMessage.update({
    where: { id: messageId },
    data: {
      executionStatus: "PROCESSING",
      metadata: { progress: { step: "calling_model", detail: "正在调用视频生成模型..." } },
    },
  });
  emitMessageDelta(messageId, { executionStatus: "PROCESSING" });

  const existing = await prisma.jobOutput.findUnique({
    where: { jobId_sequence: { jobId: job.id, sequence: 0 } },
  });

  if (existing?.status === "COMPLETED") {
    console.log(`[video-handler] job=${job.id} already completed, skipping`);
    await prisma.aiChatMessage.update({
      where: { id: messageId },
      data: { executionStatus: "COMPLETED" },
    });
    emitMessageDelta(messageId, { executionStatus: "COMPLETED" });
    await updateBackgroundJobStatus(job.id, "COMPLETED");
    return;
  }

  const output =
    existing ??
    (await prisma.jobOutput.create({
      data: { jobId: job.id, sequence: 0, status: "GENERATING" },
    }));

  try {
    // 传入已有的 Agnes task_id（如果有），provider 层会用它查询而非重新创建
    // I2V 模式：inputImageUrl 已由 resolveProviderImageSource 解析好
    const result = await generateVideos(
      {
        prompt,
        modelRef,
        apiKey: credential.apiKey,
        baseURL: credential.baseURL,
        imageUrl: inputImageUrl,
        ...(existingTaskId ? { agnesTaskId: existingTaskId } : {}),
      },
      async (percent: number, detail: string) => {
        await prisma.aiChatMessage.update({
          where: { id: messageId },
          data: { metadata: { progress: { step: "generating", percent, detail } } },
        });
      }
    );

    // 防御：确保 videos 数组有值
    if (!result.videos || result.videos.length === 0) {
      throw new Error(
        `Video provider ${result.provider} returned empty videos array. ` +
        `videos=${JSON.stringify(result.videos)}, keys=${Object.keys(result)}`
      );
    }

    const video = result.videos[0];

    if (!video.url) {
      throw new Error(
        `Video provider ${result.provider} returned video with empty url. ` +
        `video=${JSON.stringify(video)}`
      );
    }

    console.log(
      `[video-handler] got video url=${video.url} mimeType=${video.mimeType} size=${video.size ?? "unknown"}`
    );

    const asset = await saveVideoAsset({
      providerVideoUrl: video.url,
      mimeType: video.mimeType,
      size: video.size,
    });

    await prisma.jobOutput.update({
      where: { id: output.id },
      data: { status: "COMPLETED", fileAssetId: asset.id },
    });

    await prisma.aiMessageAttachment.create({
      data: {
        messageId,
        fileAssetId: asset.id,
        jobOutputId: output.id,
        type: "VIDEO",
      },
    });

    await prisma.aiChatMessage.update({
      where: { id: messageId },
      data: { executionStatus: "COMPLETED" },
    });
    emitMessageDelta(messageId, { executionStatus: "COMPLETED" });

    await updateBackgroundJobStatus(job.id, "COMPLETED", {
      result: {
        duration: Date.now() - startTime,
        model: modelRef,
        provider: result.provider,
        videoAssetId: asset.id,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;

    console.error(`[video-handler] FAILED job=${job.id}:`, {
      message: errMsg,
      stack: errStack,
      jobId: job.id,
      modelRef,
      existingTaskId,
    });

    await prisma.aiChatMessage.update({
      where: { id: messageId },
      data: {
        executionStatus: "FAILED",
        errorMessage: errMsg,
      },
    });

    await updateBackgroundJobStatus(job.id, "FAILED", { errorMessage: errMsg });

    // 重新抛出，让 worker 层决定是否 retry
    throw error;
  }
}
