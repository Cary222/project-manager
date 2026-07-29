/**
 * backfill-document-chunk-url.ts — 把现存 DOCUMENT SearchDocument 的 url
 * 升级为 /projects/<projectId>/documents/<fileAssetId>。
 *
 * 背景：
 * 上一轮修复中 processFileAssetJob 写出的 chunk url 仍然是 /api/upload/<fileAssetId>，
 * AI 参考来源会直接打开原始文件流，导致 Markdown 文档显示为乱码。
 * 详情页路由上线后，需要把已有 chunk 的 url 改写到新路径。
 *
 * 使用（一次性执行）：
 *   npx tsx scripts/backfill-document-chunk-url.ts
 *   npx tsx scripts/backfill-document-chunk-url.ts --dry-run   # 只打印，不写库
 */
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import type { FileReferenceSourceType } from "@prisma/client";

loadEnvConfig(process.cwd());

const LOG_PREFIX = "[backfill-url]";

type LegacyChunkRow = {
  id: string;
  title: string;
  url: string;
  projectId: string | null;
  documentId: string | null;
  fileAssetId: string | null;
};

function parseFlags(): { dryRun: boolean; force: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  return { dryRun, force };
}

async function resolveProjectIdFromFileAsset(
  fileAssetId: string,
): Promise<string | null> {
  const ref = await prisma.fileReference.findFirst({
    where: { fileAssetId, deletedAt: null },
    select: { sourceType: true, sourceId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ref) return null;

  switch (ref.sourceType as FileReferenceSourceType) {
    case "PROJECT":
      return ref.sourceId;
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
    default:
      return null;
  }
}

async function loadLegacyChunks(): Promise<LegacyChunkRow[]> {
  const rows = await prisma.$queryRaw<LegacyChunkRow[]>`
    SELECT
      sd.id,
      sd.title,
      sd.url,
      sd."projectId" AS "projectId",
      sd."documentId" AS "documentId",
      (sd.metadata ->> 'fileAssetId') AS "fileAssetId"
    FROM pm."SearchDocument" sd
    WHERE sd."sourceType" = 'DOCUMENT'::"SearchDocumentSourceType"
      AND sd.url LIKE '/api/upload/%'
    ORDER BY sd.title ASC, sd."chunkIndex" ASC NULLS LAST
  `;
  return rows;
}

async function main() {
  const { dryRun, force } = parseFlags();
  if (!dryRun && !force) {
    console.error(
      `${LOG_PREFIX} 必须指定 --dry-run 或 --force 之一，避免误改生产数据。`,
    );
    process.exit(1);
  }

  console.log(
    `${LOG_PREFIX} === 把 DOCUMENT chunk 的 url 从 /api/upload 切到项目文档详情页 ===`,
  );
  console.log(`${LOG_PREFIX} 模式: ${dryRun ? "DRY-RUN" : "FORCE (写入数据库)"}\n`);

  const rows = await loadLegacyChunks();
  if (rows.length === 0) {
    console.log(`${LOG_PREFIX} ✅ 没有需要回填的 chunk（全部已经指向新详情页）`);
    return;
  }

  console.log(`${LOG_PREFIX} 找到 ${rows.length} 条 chunk 待处理\n`);

  // 按 fileAssetId 分组，避免对同一 fileAsset 重复反查 projectId
  const groupedByFileAsset = new Map<string, LegacyChunkRow[]>();
  for (const row of rows) {
    const key = row.fileAssetId ?? `__missing__:${row.id}`;
    const list = groupedByFileAsset.get(key) ?? [];
    list.push(row);
    groupedByFileAsset.set(key, list);
  }

  let updated = 0;
  let skippedNoProject = 0;
  let skippedNoFileAsset = 0;
  let errors = 0;

  for (const [key, list] of groupedByFileAsset.entries()) {
    if (key.startsWith("__missing__")) {
      skippedNoFileAsset += list.length;
      console.log(
        `  ⚠ ${list.length} 条 chunk 缺失 fileAssetId metadata，跳过`,
      );
      continue;
    }

    const fileAssetId = key;
    const sample = list[0];
    const projectId =
      sample.projectId ?? (await resolveProjectIdFromFileAsset(fileAssetId));

    if (!projectId) {
      skippedNoProject += list.length;
      console.log(
        `  ⚠ "${sample.title}" | fileAssetId=${fileAssetId.slice(0, 8)}... 仍无法定位 projectId，跳过`,
      );
      continue;
    }

    const newUrl = `/projects/${projectId}/documents/${fileAssetId}`;
    const newProjectIdPatch =
      sample.projectId === null ? { projectId } : {};

    if (dryRun) {
      updated += list.length;
      console.log(
        `  [dry-run] "${sample.title}" (${list.length} chunks) → ${newUrl}`,
      );
      continue;
    }

    try {
      await prisma.searchDocument.updateMany({
        where: { id: { in: list.map((r) => r.id) } },
        data: {
          url: newUrl,
          ...newProjectIdPatch,
        } satisfies Prisma.SearchDocumentUpdateManyMutationInput,
      });
      updated += list.length;
      console.log(
        `  ✅ "${sample.title}" (${list.length} chunks) → ${newUrl}${sample.projectId === null ? " (+回填 projectId)" : ""}`,
      );
    } catch (err) {
      errors += list.length;
      console.error(
        `  ❌ "${sample.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n${LOG_PREFIX} === 完成 ===`);
  console.log(`  已更新: ${updated}`);
  console.log(`  跳过 (缺 projectId): ${skippedNoProject}`);
  console.log(`  跳过 (缺 fileAssetId): ${skippedNoFileAsset}`);
  console.log(`  错误: ${errors}`);

  if (errors > 0) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    console.error(`${LOG_PREFIX} fatal:`, err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
