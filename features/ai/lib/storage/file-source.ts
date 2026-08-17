import { prisma } from "@/shared/db/client";
import { uploadToPublicImageHost } from "./public-image-uploader";

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
 * - BASE64: 上传到公开图床（ImgBB/R2），返回公开 URL
 * - OBJECT_STORAGE: 生成 signed URL（待实现）
 * - DATABASE: 上传到公开图床（同 BASE64）
 */
export async function resolveProviderImageSource(
  fileAssetId: string,
  options?: { forcePublicUpload?: boolean }
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

  // BASE64: 上传到公开图床（Agnes 等 Provider 不支持 data URI）
  if (fileAsset.storageType === "BASE64") {
    if (!fileAsset.bytes) {
      throw new Error(`FileAsset ${fileAssetId} is BASE64 but has no bytes`);
    }

    // 如果明确要求使用 data URI（如 DashScope），直接返回
    if (options?.forcePublicUpload === false) {
      const result = {
        url: toDataUri(fileAsset.mimeType, fileAsset.bytes),
        mimeType: fileAsset.mimeType,
      };
      console.log('[file-source] BASE64 resolved as data URI', { fileAssetId });
      return result;
    }

    // 默认：上传到公开图床
    try {
      const base64Data = Buffer.from(fileAsset.bytes).toString('base64');
      const uploadResult = await uploadToPublicImageHost(base64Data, {
        mimeType: fileAsset.mimeType,
      });

      console.log('[file-source] BASE64 uploaded to public host', {
        fileAssetId,
        provider: uploadResult.provider,
        url: uploadResult.url.slice(0, 50) + '...',
      });

      return {
        url: uploadResult.url,
        mimeType: fileAsset.mimeType,
      };
    } catch (error) {
      console.error('[file-source] failed to upload BASE64 to public host', error);
      throw new Error(
        `Failed to upload BASE64 image to public host: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // DATABASE: 上传到公开图床（同 BASE64）
  // 重要约束：
  // Browser → localhost:3003 ✅
  // Agnes/Provider → localhost:3003 ❌
  if (fileAsset.storageType === "DATABASE") {
    if (!fileAsset.bytes) {
      throw new Error(`FileAsset ${fileAssetId} is DATABASE but has no bytes`);
    }

    try {
      const base64Data = Buffer.from(fileAsset.bytes).toString('base64');
      const uploadResult = await uploadToPublicImageHost(base64Data, {
        mimeType: fileAsset.mimeType,
      });

      console.log('[file-source] DATABASE uploaded to public host', {
        fileAssetId,
        provider: uploadResult.provider,
        url: uploadResult.url.slice(0, 50) + '...',
      });

      return {
        url: uploadResult.url,
        mimeType: fileAsset.mimeType,
      };
    } catch (error) {
      console.error('[file-source] failed to upload DATABASE to public host', error);
      throw new Error(
        `Failed to upload DATABASE image to public host: ${error instanceof Error ? error.message : String(error)}`
      );
    }
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
