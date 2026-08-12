import { prisma } from "@/shared/db/client";
import type { BackgroundJob } from "@prisma/client";
import { updateBackgroundJobStatus } from "../jobs";
import { emitMessageDelta } from "@/features/ai/lib/domain-events";
import { generateSingleVideo } from "@/features/ai/llm/video-generator";
import { sha256Hex } from "@/shared/lib/hash";
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
  // modelRef 格式: "agnes:agnes-video-v2.0" 或 "openai:wan2.7-video"
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

  // 解析视频生成 API Key（支持 agnes provider 的 video 模型）
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
    emitMessageDelta(messageId, { executionStatus: "FAILED" });
    return;
  }

  // 更新 message 状态
  await prisma.aiChatMessage.update({
    where: { id: messageId },
    data: { 
      executionStatus: "PROCESSING",
      metadata: { progress: { step: "calling_model", detail: "正在调用视频生成模型..." } }
    },
  });
  emitMessageDelta(messageId, {
    executionStatus: "PROCESSING",
    progress: { step: "calling_model", detail: "正在调用视频生成模型..." },
  });

  // 幂等检查：sequence=0 是否已完成
  const existing = await prisma.jobOutput.findUnique({
    where: { jobId_sequence: { jobId: job.id, sequence: 0 } },
  });
  if (existing?.status === "COMPLETED") {
    await prisma.aiChatMessage.update({
      where: { id: messageId },
      data: { executionStatus: "COMPLETED" },
    });
    await updateBackgroundJobStatus(job.id, "COMPLETED");
    emitMessageDelta(messageId, { executionStatus: "COMPLETED" });
    return;
  }

  // 占位（crash 后重试能查到，不会重新生成）
  const output =
    existing ??
    (await prisma.jobOutput.create({
      data: { jobId: job.id, sequence: 0, status: "GENERATING" },
    }));

  // 调用 AI 视频生成（传入进度回调）
  const videoResult = await generateSingleVideo(
    { prompt, modelRef, apiKey: credential.apiKey, baseURL: credential.baseURL, imageUrl },
    async (percent: number, detail: string) => {
      // 更新 DB 和 SSE
      await prisma.aiChatMessage.update({
        where: { id: messageId },
        data: { metadata: { progress: { step: "generating", percent, detail } } },
      });
      emitMessageDelta(messageId, { progress: { step: "generating", percent, detail } });
    }
  );
  const { bytes, mimeType } = videoResult;

  // 计算 checksum
  const checksum = sha256Hex(bytes);
  // Prisma Bytes 期望 Uint8Array，Buffer 转一下
  const bytesForPrisma = new Uint8Array(bytes);

  // 创建 AiFileAsset
  const asset = await prisma.aiFileAsset.create({
    data: {
      storageType: "DATABASE",
      storageKey: `db:job_${job.id}_seq_0`,
      checksum,
      bytes: bytesForPrisma,
      mimeType,
      size: bytes.length,
    },
  });

  // 更新 JobOutput
  await prisma.jobOutput.update({
    where: { id: output.id },
    data: { status: "COMPLETED", fileAssetId: asset.id },
  });

  // 创建 AiMessageAttachment
  await prisma.aiMessageAttachment.create({
    data: {
      messageId,
      fileAssetId: asset.id,
      jobOutputId: output.id,
      type: "VIDEO",
    },
  });

  // 完成
  await prisma.aiChatMessage.update({
    where: { id: messageId },
    data: { executionStatus: "COMPLETED" },
  });
  await updateBackgroundJobStatus(job.id, "COMPLETED", {
    result: { duration: Date.now() - startTime, model: modelRef, provider: "agnes" },
  });
  emitMessageDelta(messageId, { executionStatus: "COMPLETED" });
}
