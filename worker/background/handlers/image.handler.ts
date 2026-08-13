import { prisma } from "@/shared/db/client";
import type { BackgroundJob } from "@prisma/client";
import { updateBackgroundJobStatus } from "../jobs";
import { emitMessageDelta } from "@/features/ai/lib/domain-events";
import { generateSingleImage } from "@/features/ai/llm/image-generator";
import { sha256Hex } from "@/shared/lib/hash";
import { resolveCredentialWithFallback } from "@/features/ai/llm/credentials/api-key-store";
import { resolveProviderImageSource } from "@/features/ai/lib/file-source";
import { resolveGenerationMode } from "@/features/ai/routing/generation-mode";

interface ImagePayload {
  messageId: string;
  userId: string;
  prompt: string;
  modelRef?: string;
  n?: number;
  /** 输入图片文件 ID 数组（I2I 模式） */
  inputFileIds?: string[];
}

/** 解析生图 API Key — 从 DB SYSTEM/USER provider 读取 */
async function resolveImageApiKey(
  userId: string,
  modelRef: string
): Promise<{ apiKey: string; baseURL: string } | null> {
  // modelRef 格式: "openai:wan2.7-image" 或 "wanx-v1"
  const [provider] = modelRef.includes(":") ? modelRef.split(":") : ["wanx", modelRef];

  const cred = await resolveCredentialWithFallback(userId, provider);
  if (cred?.apiKey) {
    return { apiKey: cred.apiKey, baseURL: cred.baseURL };
  }

  return null;
}

export async function handleImageGenerate(
  job: BackgroundJob,
  _workerId: string,
): Promise<void> {
  const { messageId, userId, prompt, modelRef = "openai:wan2.7-image", inputFileIds } = job.payload as unknown as ImagePayload;
  const startTime = Date.now();

  // 计算生成模式（T2I vs I2I）
  const generationMode = resolveGenerationMode("image", inputFileIds);
  console.log(`[IMAGE_GENERATE] job=${job.id} mode=${generationMode} model=${modelRef}`);

  // I2I 模式：解析输入图片为 Provider 可访问的 URL
  let inputImageUrls: string[] = [];
  if (generationMode === "IMAGE_TO_IMAGE" && inputFileIds) {
    try {
      // 并行解析所有输入图片
      const sources = await Promise.all(
        inputFileIds.map((id) => resolveProviderImageSource(id))
      );
      inputImageUrls = sources.map((s) => s.url);
      console.log(`[IMAGE_GENERATE] I2I mode: ${inputImageUrls.length} input images resolved`);
      if (inputImageUrls.length > 0) {
        console.log(`[IMAGE_GENERATE] inputImages: ${inputImageUrls.join(", ")}`);
      }
    } catch (error) {
      // 文件解析失败（DATABASE storage 等）
      console.error(`[IMAGE_GENERATE] Failed to resolve input images:`, error);
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

  // 解析生图 API Key（支持 openai provider 的 wan2.7-image 或独立 wanx provider）
  const credential = await resolveImageApiKey(userId, modelRef);
  console.log(`[image-handler] userId=${userId} modelRef=${modelRef} credential=`,
    credential ? `{ apiKey: ${credential.apiKey.substring(0, 10)}..., baseURL: ${credential.baseURL} }` : null);
  
  if (!credential) {
    const msg = `生图模型 ${modelRef} 的 API Key 未配置，请在设置中添加对应 provider 的 API Key`;
    console.error(`[image-handler] ${msg}`);
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
      metadata: { progress: { step: "calling_model", percent: 0, detail: "正在调用图片生成模型..." } }
    },
  });
  emitMessageDelta(messageId, {
    executionStatus: "PROCESSING",
    progress: { step: "calling_model", percent: 0, detail: "正在调用图片生成模型..." },
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

  // 调用 AI 生图（传入进度回调）
  const imageResult = await generateSingleImage(
    { prompt, modelRef, apiKey: credential.apiKey, baseURL: credential.baseURL, imageUrls: inputImageUrls },
    async (percent: number, detail: string) => {
      // 更新 DB 和 SSE
      await prisma.aiChatMessage.update({
        where: { id: messageId },
        data: { metadata: { progress: { step: "generating", percent, detail } } },
      });
      emitMessageDelta(messageId, { progress: { step: "generating", percent, detail } });
    }
  );
  const { bytes, mimeType } = imageResult;

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
      type: "IMAGE",
    },
  });

  // 完成
  await prisma.aiChatMessage.update({
    where: { id: messageId },
    data: { executionStatus: "COMPLETED" },
  });
  const provider = (modelRef ?? "").toLowerCase().includes("wanx") ? "wanx" : "placeholder";
  await updateBackgroundJobStatus(job.id, "COMPLETED", {
    result: { duration: Date.now() - startTime, model: modelRef, provider },
  });
  emitMessageDelta(messageId, { executionStatus: "COMPLETED" });
}
