/**
 * backfill-user-search-names.ts — 回填 User.searchName 字段
 *
 * 背景：
 * #10144 上线前，User.searchName 字段不存在或为空。
 * 本脚本遍历所有 user，调 buildUserSearchTerms(name) 并写入 searchName。
 *
 * 使用（一次性执行）：
 *   npx tsx scripts/backfill-user-search-names.ts
 *
 * 验证（dry-run，只输出不写库）：
 *   npx tsx scripts/backfill-user-search-names.ts --dry-run
 *
 * 幂等：重复跑不会出错，直接 overwrite。
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import { buildUserSearchTerms } from "@/features/profile/lib/user-search";

loadEnvConfig(process.cwd());

const LOG_PREFIX = "[backfill-user-search-names]";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`${LOG_PREFIX} === 回填 User.searchName 字段 ===`);
  console.log(`${LOG_PREFIX} 模式: ${DRY_RUN ? "DRY-RUN（只输出）" : "实跑（写入数据库）"}\n`);

  const total = await prisma.user.count();
  if (total === 0) {
    console.log(`${LOG_PREFIX} ✅ 没有用户`);
    await prisma.$disconnect();
    return;
  }

  console.log(`${LOG_PREFIX} 共 ${total} 个用户，开始遍历...\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // 分批处理，每批 100 条
  const BATCH_SIZE = 100;
  for (let skip = 0; skip < total; skip += BATCH_SIZE) {
    const batch = await prisma.user.findMany({
      skip,
      take: BATCH_SIZE,
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });

    for (const user of batch) {
      const searchValue = buildUserSearchTerms(user.name);

      if (DRY_RUN) {
        console.log(`  [DRY] id=${user.id} name="${user.name ?? ""}" → searchName="${searchValue ?? ""}"`);
        skipped += 1;
      } else {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { searchName: searchValue },
          });
          updated += 1;
          console.log(`  ✅ id=${user.id} name="${user.name ?? ""}" → searchName="${searchValue ?? ""}"`);
        } catch (err) {
          errors += 1;
          console.error(`  ❌ id=${user.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  console.log(`\n${LOG_PREFIX} === 完成 ===`);
  if (DRY_RUN) {
    console.log(`  预览: ${skipped} 个用户`);
  } else {
    console.log(`  更新: ${updated}`);
    console.log(`  错误: ${errors}`);
  }

  await prisma.$disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`${LOG_PREFIX} fatal:`, err);
  await prisma.$disconnect();
  process.exit(1);
});
