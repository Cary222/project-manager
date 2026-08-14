/**
 * 解析当前轮次用户输入图片为 LLM 可消费的 image URL（data URI 或 https）。
 *
 * 流程：
 * 1. 接收上游路由已做 ownerId 校验的 CurrentInputImageAsset[]（含 id/storageType/mimeType）
 * 2. 对每个 fileAsset 调 resolveProviderImageSource 转 data URI
 *
 * 用途：把 inputImageIds 喂给 messages-builder 构造 HumanMessage([text, image_url])
 *
 * 错误策略：
 * - 任一图片解析失败 → 抛错（route.ts 上层 catch 后降级为纯文本模式，记 warn 日志）
 * - 不静默跳过失败图片，避免 LLM 收到"只有 text 没有图"的退化版本
 *
 * 性能：
 * - 复用上游 validateInputImageOwnership 已查到的 (storageType, mimeType) 字段，
 *   resolveProviderImageSource 内部虽然再次 findUnique，但路径上并行处理把
 *   N×latency 压到 1×latency（C3 fix）。合并 validate+resolve（W2）会让
 *   validate 知道 storageType/mimeType 才能在路由层直接拼 URL，但代价是
 *   把 Provider 资源解析逻辑渗到路由层，得不偿失——保留两段分工。
 */

import { resolveProviderImageSource } from "@/features/ai/lib/storage/file-source";

export interface CurrentInputImageAsset {
  id: string;
  storageType: string;
  mimeType: string | null;
}

export async function resolveCurrentInputImages(
  images: CurrentInputImageAsset[],
): Promise<string[]> {
  // C3 fix: 并行解析所有图片，把 N×latency 压到 1×latency。
  // resolveProviderImageSource 内部 findUnique 是 I/O 调用，必须并行。
  // 按原始 images 顺序聚合输出（保留 message builder 期望的 image_url part 顺序）。
  const sources = await Promise.all(
    images.map((img) => resolveProviderImageSource(img.id)),
  );
  return sources.map((s) => s.url);
}