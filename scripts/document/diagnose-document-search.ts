import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { searchDocuments } from "@/features/knowledge/lib/search";

loadEnvConfig(process.cwd());

async function main() {
  console.log("=== 诊断 1: 检查所有 sourceType 数量 ===\n");
  const counts = await prisma.$queryRaw<{ sourceType: string; cnt: bigint }[]>(Prisma.sql`
    SELECT "sourceType", COUNT(*) AS cnt
    FROM pm."SearchDocument"
    GROUP BY "sourceType"
    ORDER BY cnt DESC
  `);
  for (const row of counts) {
    console.log(`  ${row.sourceType}: ${row.cnt}`);
  }

  console.log("\n=== 诊断 2: 检查 DOCUMENT 类型 SearchDocument（最新10条）===\n");
  const docs = await prisma.$queryRaw<{
    id: string;
    sourceType: string;
    documentId: string;
    projectId: string | null;
    title: string;
    hasEmbedding: boolean;
    contentLen: number;
    updatedAt: Date;
  }[]>(Prisma.sql`
    SELECT
      id,
      "sourceType",
      "documentId",
      "projectId",
      title,
      (embedding IS NOT NULL) AS "hasEmbedding",
      length(content) AS "contentLen",
      "updatedAt"
    FROM pm."SearchDocument"
    WHERE "sourceType" = 'DOCUMENT'
    ORDER BY "updatedAt" DESC
    LIMIT 10
  `);
  console.log(`共 ${docs.length} 条 DOCUMENT SearchDocument:\n`);
  for (const doc of docs) {
    console.log(`  title=${doc.title} projectId=${doc.projectId ? "有值" : "NULL"} hasEmbedding=${doc.hasEmbedding} contentLen=${doc.contentLen}`);
  }

  console.log("\n=== 诊断 3: 检查 Document 表 ===\n");
  const docs2 = await prisma.document.findMany({
    select: { id: true, fileAssetId: true, status: true, version: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  console.log(`共 ${docs2.length} 条 Document:\n`);
  for (const d of docs2) {
    console.log(`  id=${d.id.slice(0,8)}... faId=${d.fileAssetId.slice(0,8)}... status=${d.status} v=${d.version}`);
  }

  console.log("\n=== 诊断 4: 检查 FileReference（DOCUMENT 相关）===\n");
  const refs = await prisma.$queryRaw<{ fileAssetId: string; sourceType: string; sourceId: string }[]>(Prisma.sql`
    SELECT DISTINCT "fileAssetId", "sourceType", "sourceId"
    FROM pm."FileReference"
    WHERE "sourceType" IN ('TICKET', 'PKM_NOTE', 'TICKET_COMMENT', 'PROJECT')
    LIMIT 20
  `);
  console.log(`FileReference 样本（共${refs.length}条，取前20）:\n`);
  for (const ref of refs) {
    console.log(`  faId=${ref.fileAssetId.slice(0,8)}... sourceType=${ref.sourceType} sourceId=${ref.sourceId.slice(0,8)}...`);
  }

  console.log("\n=== 诊断 5: 搜索测试（projectId=null）===\n");
  const searchTerms = ["文档", "project document", "attachment"];
  for (const term of searchTerms) {
    const r = await searchDocuments({ query: term, projectId: null, limit: 5 });
    console.log(`term="${term}" => total=${r.total} took=${r.tookMs}ms`);
    for (const item of r.results) {
      console.log(`  [${item.type}] score=${item.score.toFixed(2)} title=${item.title.slice(0, 50)}`);
    }
    console.log();
  }
}

main().catch(console.error).finally(() => void prisma.$disconnect());
