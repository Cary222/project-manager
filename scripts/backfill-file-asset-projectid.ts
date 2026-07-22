/**
 * backfill-file-asset-projectid.ts — 回填现有 SearchDocument 的 projectId
 *
 * 背景：
 * 方案 A 上线前，已处理过的 DOCUMENT 类型的 SearchDocument 没有 projectId。
 * 本脚本遍历所有 projectId 为空的 DOCUMENT SearchDocument，
 * 通过 FileReference 链反查 projectId 并更新。
 *
 * 使用（一次性执行）：
 *   npx tsx scripts/backfill-file-asset-projectid.ts
 *
 * 验证（执行后）：
 *   npx tsx scripts/verify-file-asset-projectid.ts
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import type { FileReferenceSourceType } from "@prisma/client";

loadEnvConfig(process.cwd());

const LOG_PREFIX = "[backfill]";

/**
 * 从 shared/lib/document.ts 复制的 resolveProjectIdFromFileAsset 逻辑
 *（避免直接 import，因为脚本环境 tsconfig path 可能不一致）
 */
async function resolveProjectIdFromFileAsset(fileAssetId: string): Promise<string | null> {
  const ref = await prisma.fileReference.findFirst({
    where: { fileAssetId, deletedAt: null },
    select: { sourceType: true, sourceId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ref) return null;

  switch (ref.sourceType as FileReferenceSourceType) {
    case "PKM_NOTE": {
      const note = await prisma.pkmNote.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      return note?.projectId ?? null;
    }
    case "TICKET": {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      return ticket?.projectId ?? null;
    }
    case "TICKET_COMMENT": {
      const comment = await prisma.ticketComment.findUnique({
        where: { id: ref.sourceId },
        select: { ticket: { select: { projectId: true } } },
      });
      return comment?.ticket.projectId ?? null;
    }
    case "PROJECT":
      return ref.sourceId;
    default:
      return null;
  }
}

async function main() {
  console.log(`${LOG_PREFIX} === 回填 DOCUMENT SearchDocument.projectId ===\n`);

  // Step 1: 找出所有 projectId 为空的 DOCUMENT SearchDocument
  const docsToFix = await prisma.$queryRaw<Array<{ id: string; title: string; fileAssetId: string | null }>>`
    SELECT
      sd.id,
      sd.title,
      (sd.metadata ->> 'fileAssetId') AS "fileAssetId"
    FROM pm."SearchDocument" sd
    WHERE sd."sourceType" = 'DOCUMENT'::"SearchDocumentSourceType"
      AND sd."projectId" IS NULL
    LIMIT 100
  `;

  if (docsToFix.length === 0) {
    console.log(`${LOG_PREFIX} ✅ 没有需要回填的 DOCUMENT SearchDocument`);
    await prisma.$disconnect();
    return;
  }

  console.log(`${LOG_PREFIX} 找到 ${docsToFix.length} 条需要回填的记录\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of docsToFix) {
    const fileAssetId = doc.fileAssetId;
    if (!fileAssetId) {
      skipped += 1;
      console.log(`  ⚠ "${doc.title}" | 无 fileAssetId，跳过`);
      continue;
    }

    try {
      const projectId = await resolveProjectIdFromFileAsset(fileAssetId);

      if (!projectId) {
        skipped += 1;
        console.log(`  ⚠ "${doc.title}" | FileReference 存在但查不到 projectId，跳过`);
        continue;
      }

      // 更新 SearchDocument
      await prisma.searchDocument.update({
        where: { id: doc.id },
        data: { projectId },
      });

      // 顺便更新同一 documentId 下的所有 chunks
      await prisma.searchDocument.updateMany({
        where: { documentId: doc.id },
        data: { projectId },
      });

      updated += 1;
      console.log(`  ✅ "${doc.title}" → projectId: ${projectId.slice(0, 8)}...`);
    } catch (err) {
      errors += 1;
      console.error(`  ❌ "${doc.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${LOG_PREFIX} === 完成 ===`);
  console.log(`  更新: ${updated}`);
  console.log(`  跳过: ${skipped}`);
  console.log(`  错误: ${errors}`);

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`${LOG_PREFIX} fatal:`, err);
  await prisma.$disconnect();
  process.exit(1);
});
