import { prisma } from "@/shared/db/client";

export interface ProviderFileSource {
  url: string;       // Provider 真正可访问的资源
  mimeType: string;
}

/**
 * 根据 storageType 解析 FileAsset 为 Provider 可用的源
 *
 * 关键约束：返回的 URL 必须能让外部 Provider（Agnes 等）访问
 *
 * 支持的 storageType：
 * - REMOTE_URL: 直接返回 storageKey（已经是外部可访问 URL）
 * - OBJECT_STORAGE: 生成 signed URL（待实现）
 * - DATABASE: 当前不支持（Provider 无法访问 localhost）
 */
export async function resolveProviderImageSource(
  fileAssetId: string
): Promise<ProviderFileSource> {
  const fileAsset = await prisma.aiFileAsset.findUnique({
    where: { id: fileAssetId },
    select: {
      storageType: true,
      storageKey: true,
      mimeType: true,
      bytes: true,
    },
  });

  function toDataUri(mimeType: string, bytes: Uint8Array | null): string {
    if (!bytes) {
      throw new Error(`FileAsset ${fileAssetId} has no bytes to build data URI`);
    }
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  if (!fileAsset) {
    throw new Error(`FileAsset not found: ${fileAssetId}`);
  }

  if (!fileAsset.mimeType) {
    throw new Error(`FileAsset ${fileAssetId} has no mimeType`);
  }

  // REMOTE_URL: 直接使用 storageKey
  if (fileAsset.storageType === "REMOTE_URL") {
    if (!fileAsset.storageKey) {
      throw new Error(`FileAsset ${fileAssetId} is REMOTE_URL but has no storageKey`);
    }
    return {
      url: fileAsset.storageKey,
      mimeType: fileAsset.mimeType,
    };
  }

  // BASE64: 数据存于 bytes（无索引字段），从 bytes 重建 data URI 返回
  // （DashScope Wanx API 支持 Base64 data URI 输入，无需外部可访问 URL）
  if (fileAsset.storageType === "BASE64") {
    return {
      url: toDataUri(fileAsset.mimeType, fileAsset.bytes),
      mimeType: fileAsset.mimeType,
    };
  }

  // DATABASE: 当前不支持（Provider 无法访问 localhost）
  // 重要约束：
  // Browser → localhost:3003 ✅
  // Agnes/Provider → localhost:3003 ❌
  if (fileAsset.storageType === "DATABASE") {
    throw new Error(
      `FileAsset ${fileAssetId} uses DATABASE storage, which is not accessible by external Providers. ` +
      `Please use REMOTE_URL storage for I2I/I2V inputs. ` +
      `Future enhancement: temporary upload to Provider or object storage.`
    );
  }

  // OBJECT_STORAGE: 待实现
  if (fileAsset.storageType === "OBJECT_STORAGE") {
    throw new Error(
      `FileAsset ${fileAssetId} uses OBJECT_STORAGE, but signed URL generation is not yet implemented. ` +
      `Please use REMOTE_URL storage for now.`
    );
  }

  throw new Error(`Unknown storageType: ${fileAsset.storageType}`);
}
