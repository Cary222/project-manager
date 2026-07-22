/**
 * cleanup-old-jobs.ts — 一次性清理废弃 IndexJob 记录。
 *
 * 删除候选（均为 30 天前）：
 *   - PENDING  jobs：按 createdAt（长期卡住视为废弃）
 *   - COMPLETED jobs：按 updatedAt（历史垃圾）
 *
 * 不删除：FAILED / PROCESSING
 *
 * 用法：
 *   npx tsx scripts/cleanup-old-jobs.ts --dry-run    # 只读预览
 *   npx tsx scripts/cleanup-old-jobs.ts --force     # 执行删除
 *
 * 注意：
 *   --dry-run 和 --force 同时传时，dry-run 优先，不执行删除。
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

const CUTOFF_DAYS = 30;

type CliFlags = {
  dryRun: boolean;
  force: boolean;
};

function parseCliFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, force: false };
  for (const arg of argv) {
    if (arg === "--dry-run") flags.dryRun = true;
    if (arg === "--force") flags.force = true;
  }
  return flags;
}

type CountByTarget = { targetType: string; count: bigint }[];

async function countPendingByTargetType(cutoff: Date): Promise<CountByTarget> {
  const raw = await prisma.indexJob.groupBy({
    by: ["targetType"],
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    _count: { id: true },
  });
  return raw.map((r) => ({ targetType: r.targetType, count: BigInt(r._count.id) }));
}

async function countCompletedByTargetType(cutoff: Date): Promise<CountByTarget> {
  const raw = await prisma.indexJob.groupBy({
    by: ["targetType"],
    where: { status: "COMPLETED", updatedAt: { lt: cutoff } },
    _count: { id: true },
  });
  return raw.map((r) => ({ targetType: r.targetType, count: BigInt(r._count.id) }));
}

async function main() {
  const flags = parseCliFlags(process.argv.slice(2));

  if (!flags.dryRun && !flags.force) {
    console.log(`Usage: npx tsx scripts/cleanup-old-jobs.ts [--dry-run] [--force]

Options:
  --dry-run  Show candidate counts and exit without deleting
  --force    Actually delete the jobs

When both --dry-run and --force are passed, dry-run takes priority.

Cleanup candidates (cutoff: ${CUTOFF_DAYS} days):
  - PENDING   jobs older than ${CUTOFF_DAYS} days (by createdAt)
  - COMPLETED jobs older than ${CUTOFF_DAYS} days (by updatedAt)
  - FAILED / PROCESSING are NOT deleted.
`);
    process.exitCode = 1;
    return;
  }

  const cutoff = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString();

  console.log(`=== cleanup-old-jobs ===`);
  console.log(`Cutoff: ${cutoffStr} (${CUTOFF_DAYS} days ago)`);

  const pendingByType = await countPendingByTargetType(cutoff);
  const totalPending = pendingByType.reduce((s, r) => s + r.count, 0n);

  const completedByType = await countCompletedByTargetType(cutoff);
  const totalCompleted = completedByType.reduce((s, r) => s + r.count, 0n);

  const totalCandidates = totalPending + totalCompleted;

  console.log(`\nCandidates (${totalCandidates} total):`);

  if (totalPending > 0n) {
    console.log(`  PENDING (by createdAt, ${totalPending}):`);
    for (const r of pendingByType) {
      console.log(`    ${r.targetType}: ${r.count}`);
    }
  } else {
    console.log("  PENDING: 0");
  }

  if (totalCompleted > 0n) {
    console.log(`  COMPLETED (by updatedAt, ${totalCompleted}):`);
    for (const r of completedByType) {
      console.log(`    ${r.targetType}: ${r.count}`);
    }
  } else {
    console.log("  COMPLETED: 0");
  }

  if (flags.dryRun) {
    console.log(`\n[dry-run] No changes made.`);
    return;
  }

  // --force path
  console.log(`\n[force] Deleting...`);

  const pendingDelete = await prisma.indexJob.deleteMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
  });

  const completedDelete = await prisma.indexJob.deleteMany({
    where: { status: "COMPLETED", updatedAt: { lt: cutoff } },
  });

  console.log(`  PENDING   deleted: ${pendingDelete.count}`);
  console.log(`  COMPLETED deleted: ${completedDelete.count}`);
  console.log(`  Total deleted: ${pendingDelete.count + completedDelete.count}`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
