import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

async function main() {
  // 查询所有 FILE_ASSET IndexJob（只看未完成的）
  const pending = await prisma.indexJob.findMany({
    where: { targetType: "FILE_ASSET", status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, targetId: true, attempt: true, createdAt: true },
    take: 10,
  });
  console.log(`=== 未完成的 FILE_ASSET IndexJob（${pending.length} 条）===\n`);
  pending.forEach((j) =>
    console.log(`  status=${j.status} attempt=${j.attempt} targetId=${j.targetId.slice(0,12)} created=${j.createdAt.toISOString()}`)
  );

  // 查最新 FILE_ASSET IndexJob（任意状态）
  const latest = await prisma.indexJob.findFirst({
    where: { targetType: "FILE_ASSET" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, targetId: true, attempt: true, createdAt: true, error: true },
  });
  console.log(`\n=== 最新 FILE_ASSET IndexJob ===`);
  console.log(`  id=${latest?.id} status=${latest?.status} targetId=${latest?.targetId} attempt=${latest?.attempt} err=${latest?.error?.slice(0,60)}`);
}

main().catch(console.error);
