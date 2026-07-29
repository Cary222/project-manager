import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

async function main() {
  console.log("=== 诊断 Document FAILED 原因 ===\n");

  const docs = await prisma.document.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10,
    where: { status: "FAILED" },
    include: {
      fileAsset: {
        select: { mimeType: true, originalName: true, size: true, createdAt: true, status: true },
      },
    },
  });

  console.log(`共 ${docs.length} 条 FAILED Document:\n`);
  for (const doc of docs) {
    console.log(`Document id=${doc.id}`);
    console.log(`  fileAsset: ${doc.fileAsset.originalName}`);
    console.log(`  mimeType=${doc.fileAsset.mimeType} size=${doc.fileAsset.size}`);
    console.log(`  faStatus=${doc.fileAsset.status}`);
    console.log(`  faCreatedAt=${doc.fileAsset.createdAt}`);
    console.log(`  Document version=${doc.version}`);
    console.log(`  error=${doc.error ?? "null"}`);
    console.log();
  }

  console.log("=== 诊断 IndexJob（最新20条）===\n");
  const jobs = await prisma.indexJob.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      targetType: true,
      targetId: true,
      status: true,
      error: true,
      attempt: true,
      updatedAt: true,
    },
  });
  for (const job of jobs) {
    console.log(`  [${job.status}] ${job.targetType} ${job.targetId.slice(0,8)}... attempt=${job.attempt} error=${job.error ?? ""}`);
  }

  console.log("\n=== 诊断 Embedding 服务是否可达 ===\n");
  const embeddingUrl = process.env.EMBEDDING_API_URL ?? "http://localhost:5000";
  console.log(`  EMBEDDING_API_URL=${embeddingUrl}`);
  try {
    const res = await fetch(`${embeddingUrl}/health`, { signal: AbortSignal.timeout(3000) });
    console.log(`  /health status=${res.status}`);
  } catch (e) {
    console.log(`  /health 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

main().catch(console.error).finally(() => void prisma.$disconnect());
