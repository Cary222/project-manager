import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";

export type FileReferenceSourceType = "PKM_NOTE" | "TICKET" | "TICKET_COMMENT" | "PROJECT" | "PROJECT_MEETING";

/**
 * 在事务内记录一条文件引用（upsert，deletedAt = null）。
 * 调用方必须传入 prisma.$transaction 的 tx client。
 */
export async function recordFileReference(
  tx: Prisma.TransactionClient,
  params: {
    fileAssetId: string;
    sourceType: FileReferenceSourceType;
    sourceId: string;
  },
): Promise<void> {
  await tx.fileReference.upsert({
    where: {
      fileAssetId_sourceType_sourceId: {
        fileAssetId: params.fileAssetId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
      },
    },
    create: {
      fileAssetId: params.fileAssetId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
    },
    update: {
      deletedAt: null,
    },
  });
}

/**
 * 软删除一个 sourceType/sourceId 下的所有引用（设 deletedAt = now）。
 * PR10 仅实现基础逻辑，业务 hook 留 PR11。
 */
export async function removeFileReferences(
  tx: Prisma.TransactionClient,
  params: {
    sourceType: FileReferenceSourceType;
    sourceId: string;
    fileAssetIds?: string[];
  },
): Promise<{ count: number }> {
  const where = {
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    deletedAt: null,
    ...(params.fileAssetIds ? { fileAssetId: { in: params.fileAssetIds } } : {}),
  };
  const result = await tx.fileReference.updateMany({
    where,
    data: { deletedAt: new Date() },
  });
  return { count: result.count };
}

/**
 * 查询某个文件的所有有效引用（deletedAt = null）。
 * 用于 DocsTab 显示"哪些单子/笔记引用了这个文件"。
 */
export async function getFileReferences(fileAssetId: string) {
  return prisma.fileReference.findMany({
    where: { fileAssetId, deletedAt: null },
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * 统计一个文件的有效引用数。
 */
export async function countActiveReferences(fileAssetId: string): Promise<number> {
  return prisma.fileReference.count({
    where: { fileAssetId, deletedAt: null },
  });
}
