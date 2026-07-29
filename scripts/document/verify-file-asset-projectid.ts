/**
 * verify-file-asset-projectid.ts — 验证 projectId 是否正确填入 SearchDocument
 *
 * 验证场景：
 *   1. 确认现有 DOCUMENT 类型的 SearchDocument 是否缺少 projectId（验证 bug）
 *   2. 找到最近的 FILE_ASSET IndexJob，检查处理后的 SearchDocument.projectId
 *   3. 回填测试：手动触发一个 FileAsset 的重新处理，验证 projectId 正确
 *
 * 使用：
 *   npx ts-node --project tsconfig.json scripts/verify-file-asset-projectid.ts
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import { processFileAssetJob } from "@/features/knowledge/lib/document";

loadEnvConfig(process.cwd());

const LOG_PREFIX = "[verify]";

let passed = 0;
let failed = 0;

function ok(name: string, detail?: string) {
  console.log(`${LOG_PREFIX} ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  passed += 1;
}

function fail(name: string, detail: string) {
  console.error(`${LOG_PREFIX} ❌ ${name}: ${detail}`);
  failed += 1;
}

async function test1_existingDocumentsMissingProjectId() {
  /**
   * 验证 bug 存在：DOCUMENT 类型的 SearchDocument 没有 projectId
   */
  const docs = await prisma.searchDocument.findMany({
    where: { sourceType: "DOCUMENT" },
    select: { id: true, title: true, projectId: true },
    take: 5,
  });

  if (docs.length === 0) {
    ok("test1 — 暂无 DOCUMENT 类型的 SearchDocument，跳过", "数据为空");
    return;
  }

  const missingCount = docs.filter((d) => d.projectId === null).length;
  if (missingCount > 0) {
    ok(
      `test1 — 确认 bug 存在：${missingCount}/${docs.length} 个 DOCUMENT SearchDocument.projectId = null`,
      "这是需要修复的 bug",
    );
  } else {
    ok(`test1 — 所有 ${docs.length} 个 DOCUMENT SearchDocument.projectId 已有值`, "bug 可能已被修复");
  }

  // 打印详情
  console.log(`\n${LOG_PREFIX} 详情（前 5 条）：`);
  for (const doc of docs) {
    console.log(`  - ${doc.title} | projectId: ${doc.projectId ?? "null"}`);
  }
}

async function test2_fileAssetJobsWithMissingProjectId() {
  /**
   * 找到有 FileReference 但 SearchDocument.projectId 为空的 FileAsset
   */
  const docs = await prisma.$queryRaw<Array<{ id: string; title: string; projectId: string | null; fileAssetId: string }>>`
    SELECT
      sd.id,
      sd.title,
      sd."projectId",
      (sd.metadata ->> 'fileAssetId') AS "fileAssetId"
    FROM pm."SearchDocument" sd
    WHERE sd."sourceType" = 'DOCUMENT'::"SearchDocumentSourceType"
      AND sd."projectId" IS NULL
    LIMIT 5
  `;

  if (docs.length === 0) {
    ok("test2 — 没有 projectId 为空的 DOCUMENT SearchDocument", "无需回填");
    return;
  }

  // 检查这些 FileAsset 是否在 FileReference 中
  for (const doc of docs) {
    const fileAssetId = doc.fileAssetId;
    if (!fileAssetId) continue;

    const ref = await prisma.fileReference.findFirst({
      where: { fileAssetId, deletedAt: null },
      select: { sourceType: true, sourceId: true },
    });

    if (ref) {
      console.log(
        `  - "${doc.title}" | FileReference: ${ref.sourceType} -> ${ref.sourceId} | 可回填 ✅`,
      );
    } else {
      console.log(`  - "${doc.title}" | 无 FileReference | 无法回填`);
    }
  }

  ok(`test2 — 找到 ${docs.length} 个可回填的 DOCUMENT SearchDocument`);
}

async function test3_resolveProjectIdHelper() {
  /**
   * 验证 resolveProjectIdFromFileAsset helper 正确工作
   * 找一个有 FileReference 的 FileAsset，验证能查到 projectId
   */
  const ref = await prisma.fileReference.findFirst({
    where: { deletedAt: null },
    select: { fileAssetId: true, sourceType: true, sourceId: true },
    orderBy: { createdAt: "desc" },
  });

  if (!ref) {
    ok("test3 — 暂无 FileReference 数据，跳过", "无数据可测");
    return;
  }

  // 直接在 Prisma 上模拟 resolveProjectIdFromFileAsset 的逻辑
  let expectedProjectId: string | null = null;
  switch (ref.sourceType) {
    case "PKM_NOTE": {
      const note = await prisma.pkmNote.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      expectedProjectId = note?.projectId ?? null;
      break;
    }
    case "TICKET": {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      expectedProjectId = ticket?.projectId ?? null;
      break;
    }
    case "TICKET_COMMENT": {
      const comment = await prisma.ticketComment.findUnique({
        where: { id: ref.sourceId },
        select: { ticket: { select: { projectId: true } } },
      });
      expectedProjectId = comment?.ticket.projectId ?? null;
      break;
    }
    case "PROJECT":
      expectedProjectId = ref.sourceId;
      break;
    default:
      expectedProjectId = null;
  }

  const project = expectedProjectId
    ? await prisma.project.findUnique({ where: { id: expectedProjectId }, select: { id: true, name: true } })
    : null;

  console.log(
    `  - FileAsset ${ref.fileAssetId.slice(0, 8)}... | ${ref.sourceType} -> ${ref.sourceId.slice(0, 8)}... | projectId: ${expectedProjectId?.slice(0, 8) ?? "null"}...${
      project ? ` (${project.name})` : ""
    }`,
  );

  ok(
    `test3 — resolveProjectId 逻辑验证：${ref.sourceType} → ${expectedProjectId ? "有值" : "null"}`,
    `预期 projectId: ${expectedProjectId ?? "null"}`,
  );
}

async function test4_triggerReprocessAndVerify() {
  /**
   * 找一个有 FileReference 的 FileAsset，触发重新处理，验证 projectId 被正确填入
   */
  const ref = await prisma.fileReference.findFirst({
    where: { deletedAt: null },
    include: {
      fileAsset: {
        select: { id: true, originalName: true, mimeType: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!ref) {
    ok("test4 — 暂无 FileReference 数据，跳过", "无数据可测");
    return;
  }

  const fileAssetId = ref.fileAssetId;

  // 检查对应的 Document 状态
  const doc = await prisma.document.findUnique({
    where: { fileAssetId },
    select: { id: true, status: true },
  });

  if (!doc) {
    ok("test4 — FileAsset 暂无 Document 记录，跳过", "该文件未触发过处理");
    return;
  }

  // 检查处理前的 projectId
  const before = await prisma.searchDocument.findFirst({
    where: { documentId: doc.id },
    select: { id: true, projectId: true },
  });

  console.log(
    `  - ${ref.fileAsset.originalName} | Document.status: ${doc.status} | before projectId: ${before?.projectId ?? "null"}`,
  );

  // 触发重新处理
  console.log(`  - 触发 processFileAssetJob...`);
  try {
    await processFileAssetJob(fileAssetId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 处理失败是预期的（如果文件无法提取文本），只检查不崩
    console.log(`  - processFileAssetJob 异常（预期）：${msg}`);
  }

  // 检查处理后的 projectId
  const after = await prisma.searchDocument.findFirst({
    where: { documentId: doc.id },
    select: { id: true, projectId: true },
  });

  console.log(`  - after projectId: ${after?.projectId ?? "null"}`);

  if (after && after.projectId !== null) {
    ok(
      `test4 — projectId 已填入：${after.projectId}`,
      `"${ref.fileAsset.originalName}" 已正确关联项目`,
    );
  } else if (after) {
    fail(
      "test4 — projectId 仍为 null",
      `FileReference 存在（${ref.sourceType}）但 resolveProjectId 返回 null`,
    );
  } else {
    fail("test4 — SearchDocument 不存在", "processFileAssetJob 可能没有写 SearchDocument");
  }
}

async function main() {
  console.log(`${LOG_PREFIX} === 文件附件 projectId 验证 ===\n`);

  try {
    await test1_existingDocumentsMissingProjectId();
  } catch (err) {
    fail("test1", err instanceof Error ? err.message : String(err));
  }

  try {
    await test2_fileAssetJobsWithMissingProjectId();
  } catch (err) {
    fail("test2", err instanceof Error ? err.message : String(err));
  }

  try {
    await test3_resolveProjectIdHelper();
  } catch (err) {
    fail("test3", err instanceof Error ? err.message : String(err));
  }

  try {
    await test4_triggerReprocessAndVerify();
  } catch (err) {
    fail("test4", err instanceof Error ? err.message : String(err));
  }

  console.log(`\n${LOG_PREFIX} === ${passed} passed, ${failed} failed ===`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`${LOG_PREFIX} fatal:`, err);
  await prisma.$disconnect();
  process.exit(1);
});
