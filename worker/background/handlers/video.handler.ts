import { prisma } from "@/shared/db/client";
import type { BackgroundJob } from "@prisma/client";
import { updateBackgroundJobStatus } from "../jobs";
import { generateVideos } from "@/features/ai/llm/video-generator";
import { saveVideoAsset } from "@/features/ai/llm/video-providers/storage";
import { resolveCredentialWithFallback } from "@/features/ai/llm/credentials/api-key-store";

interface VideoPayload {
  messageId: string;
  userId: string;
  prompt: string;
  modelRef?: string;
  imageUrl?: string;
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
  const { messageId, userId, prompt, modelRef = "agnes:agnes-video-v2.0", imageUrl } = job.payload as unknown as VideoPayload;
  const startTime = Date.now();

  const credential = await resolveVideoApiKey(userId, modelRef);
  console.log(`[video-handler] userId=${userId} modelRef=${modelRef} credential=`, 
    credential ? `{ apiKey: ${credential.apiKey.substring(0, 10)}..., baseURL: ${credential.baseURL} }` : null);
  
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
      metadata: { progress: { step: "calling_model", detail: "正在调用视频生成模型..." } }
    },
  });

  const existing = await prisma.jobOutput.findUnique({
    where: { jobId_sequence: { jobId: job.id, sequence: 0 } },
  });
  if (existing?.status === "COMPLETED") {
    await prisma.aiChatMessage.update({
      where: { id: messageId },
      data: { executionStatus: "COMPLETED" },
    });
    await updateBackgroundJobStatus(job.id, "COMPLETED");
    return;
  }

  const output =
    existing ??
    (await prisma.jobOutput.create({
      data: { jobId: job.id, sequence: 0, status: "GENERATING" },
    }));

  const result = await generateVideos(
    { prompt, modelRef, apiKey: credential.apiKey, baseURL: credential.baseURL, imageUrl },
    async (percent: number, detail: string) => {
      await prisma.aiChatMessage.update({
        where: { id: messageId },
        data: { metadata: { progress: { step: "generating", percent, detail } } },
      });
    }
  );

  const video = result.videos[0];
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
  await updateBackgroundJobStatus(job.id, "COMPLETED", {
    result: { duration: Date.now() - startTime, model: modelRef, provider: result.provider },
  });
}
