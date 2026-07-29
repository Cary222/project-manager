/**
 * apply-search-name-column.ts — 直接添加 User.searchName 列
 * 绕过 prisma db push 的 UploadedFile 迁移冲突
 */
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

async function main() {
  const LOG_PREFIX = "[apply-search-name-column]";

  try {
    // 检查列是否已存在
    const colCheck = await prisma.$queryRaw<{ exists: boolean }[]>(
      Prisma.sql`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'pm'
          AND table_name = 'User'
          AND column_name = 'searchName'
      ) AS "exists"`
    );

    if (colCheck[0]?.exists) {
      console.log(`${LOG_PREFIX} ✅ 列 "searchName" 已存在，无需操作`);
    } else {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "pm"."User" ADD COLUMN IF NOT EXISTS "searchName" TEXT;`
      );
      console.log(`${LOG_PREFIX} ✅ 列 "searchName" 已创建`);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} ❌`, err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("[apply-search-name-column] fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
