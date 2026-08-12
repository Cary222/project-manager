import { prisma } from "@/shared/db/client";
import type { AiFileAsset } from "@prisma/client";

/**
 * 持久化视频 Provider URL 到 AiFileAsset（REMOTE_URL 模式）
 *
 * 架构原则：Handler 调用此接口，不直接操作 prisma.aiFileAsset。
 * 未来迁移对象存储时只改此函数内部，Handler 不变。
 */
export async function saveVideoAsset(params: {
  providerVideoUrl: string;
  mimeType: string;
  size?: number;
}): Promise<AiFileAsset> {
  const { providerVideoUrl, mimeType, size } = params;

  return prisma.aiFileAsset.create({
    data: {
      storageType: "REMOTE_URL",
      storageKey: providerVideoUrl,
      mimeType,
      size: size ?? null,
      // bytes 必须为 null（REMOTE_URL 模式）
    },
  });
}
