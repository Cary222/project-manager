/**
 * 批量解析历史轮次的 user message INPUT 图片 → image URLs（data URI / https）。
 *
 * 解决 N+1：一次 findMany 查所有历史轮次涉及的 INPUT attachments + 它们的 AiFileAsset，
 * 在内存里按 messageId 聚合，然后对每个 AiFileAsset 调 resolveProviderImageSource。
 *
 * 用途：
 * - 喂给 messages-builder.historyImageUrls 参数
 * - 重建历史 user message 为多模态 HumanMessage（不丢上下文）
 *
 * 边界：
 * - 只查 direction=INPUT 的 attachment（OUTPUT 是 AI 生成的图，不属于 user input）
 * - 历史轮次最多查最近 N 条（由调用方按 truncated 窗口的 messageId 传入）
 *
 * 失败日志（W7 partial）：
 * - 解析失败的 fileAssetId 落到 failures[]，调用方按 messageId 聚合时附带 context
 * - 若失败数 > 0，调用方在 route 层打印前 3 条样本（messageId/assetId/reason）
 * - 本函数本身只在 console 输出 "history image resolve failed: count=N"，避免重复
 * - 完整 messageId 反查在 route 层（W7 follow-up 与 W1 history-window 改动一起做）
 */

import { prisma } from "@/shared/db/client";
import { resolveProviderImageSource } from "@/features/ai/lib/storage/file-source";

export interface HistoryInputResolution {
  /** messageId → imageUrls[]（按调用的原始顺序追加） */
  urlsByMessageId: Map<string, string[]>;
  /** 解析失败的 messageId + fileAssetId + reason（不影响其它图片） */
  failures: Array<{ messageId: string; fileAssetId: string; error: string }>;
}

export async function resolveHistoryInputImages(
  messageIds: string[],
): Promise<HistoryInputResolution> {
  if (messageIds.length === 0) {
    return { urlsByMessageId: new Map(), failures: [] };
  }

  // 单次查询：所有 INPUT attachments（带 fileAsset 必要字段）
  const attachments = await prisma.aiMessageAttachment.findMany({
    where: {
      messageId: { in: messageIds },
      direction: "INPUT",
    },
    select: {
      messageId: true,
      fileAssetId: true,
    },
  });

  // 按 fileAssetId 去重（同一文件可能挂多个 attachment）
  const uniqueFileAssetIds = Array.from(new Set(attachments.map((a) => a.fileAssetId)));

  // 并行解析所有图片
  const resolvedUrls = new Map<string, string>(); // fileAssetId → url
  const failures: HistoryInputResolution["failures"] = [];

  await Promise.all(
    uniqueFileAssetIds.map(async (faId) => {
      try {
        const source = await resolveProviderImageSource(faId);
        resolvedUrls.set(faId, source.url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ messageId: "", fileAssetId: faId, error: msg });
      }
    }),
  );

  // 按 messageId 聚合
  const urlsByMessageId = new Map<string, string[]>();
  for (const att of attachments) {
    const url = resolvedUrls.get(att.fileAssetId);
    if (!url) continue; // skip failures
    const arr = urlsByMessageId.get(att.messageId) ?? [];
    arr.push(url);
    urlsByMessageId.set(att.messageId, arr);
  }

  // 失败记录补 messageId（取第一个关联的 messageId，足以定位）
  for (const att of attachments) {
    if (!resolvedUrls.has(att.fileAssetId)) {
      const existing = failures.find((f) => f.fileAssetId === att.fileAssetId);
      if (existing && !existing.messageId) {
        existing.messageId = att.messageId;
      }
    }
  }

  if (failures.length > 0) {
    // 输出前 3 条样本，便于排查 ownerId=NULL 历史行 / 缺 bytes 等常见失败
    const sample = failures.slice(0, 3).map(
      (f) => `messageId=${f.messageId || "?"} assetId=${f.fileAssetId} reason=${f.error}`
    );
    console.warn(
      `[resolveHistoryInputImages] ${failures.length} failure(s). sample=[${sample.join(" | ")}]`
    );
  }

  return { urlsByMessageId, failures };
}