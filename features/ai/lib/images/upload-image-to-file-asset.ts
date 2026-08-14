/**
 * AI 多模态输入上传 helper
 *
 * 把 File 上传到 /api/ai/file-assets（JSON + BASE64 通道），返回 AiFileAsset 元数据。
 *
 * 用途：Chat 模式识图、Image I2I、Video I2V 三个场景共用。
 * 服务端会自动写入 ownerId = session.user.id（#10208 ownerId 基础安全修复）。
 *
 * 与知识库 /api/upload 的区别：
 * - /api/upload 写 FileAsset（uploaderId）→ 仅供前端渲染
 * - /api/ai/file-assets 写 AiFileAsset（ownerId）→ 同时供前端渲染 + LLM 推理
 *
 * @throws ImageCompressionError 图片无法压缩到限制
 * @throws Error 服务端返回非 2xx
 */

import { compressImage, ImageCompressionError } from "./image-compressor";

export interface AiUploadedImage {
  /** AiFileAsset.id，前端发消息时传给 inputImageIds */
  id: string;
  /** Data URI，前端用于本地预览 */
  url: string;
  mimeType: string;
}

interface FileAssetsResponse {
  id: string;
  url: string;
  name?: string;
  mimeType: string;
  size?: number;
}

/**
 * 上传一张图片到 AiFileAsset，返回 { id, url, mimeType }
 *
 * 流程：
 * 1. 客户端 compressImage → data URI（避免大图 FormData 解析失败）
 * 2. POST /api/ai/file-assets（JSON 通道，BASE64 存储）
 * 3. 服务端写 ownerId = session.user.id
 * 4. 返回 AiFileAsset.id 用于发消息时挂 AiMessageAttachment(INPUT)
 */
export async function uploadImageToFileAsset(file: File): Promise<AiUploadedImage> {
  // 1. 压缩并转 data URI（复用 image-compressor）
  const dataUri = await compressImage(file);

  // 2. POST JSON
  const res = await fetch("/api/ai/file-assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: "image/jpeg",
      fileSize: dataUri.length,
      source: "user_upload",
      storageType: "BASE64",
      storageKey: dataUri,
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `上传失败 HTTP ${res.status}`);
  }

  const data = (await res.json()) as FileAssetsResponse;
  return {
    id: data.id,
    url: dataUri, // 本地预览用 data URI（避免再次 HTTP 请求 DB）
    mimeType: data.mimeType,
  };
}

export { ImageCompressionError };
