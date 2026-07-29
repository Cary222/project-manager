/**
 * test-user-search.ts — 验证 User.searchName 人名模糊匹配
 *
 * 测试逻辑（Step 3）：
 *   - resolveUser 将输入转为 allTerms（token + pinyin 变体）
 *   - 每个 term 拿去查 searchName contains
 *   - 所以 searchName 里只要存了"xu"就能搜"许敏捷"，存了"jing"就能搜"Jing Zhang"
 *
 * 测试用例（覆盖 Step 3 searchName contains 逻辑）：
 *   输入 "jing"  → 期望命中 "Jing Zhang"（searchName 含 "jing zhang"）
 *   输入 "xu"    → 期望命中 "许敏捷"（searchName 含 "xuminjie"）
 *   输入 "maidy" → 期望命中 "maidy"
 *
 * 不在 Step 3 范围的中文昵称→拼音名映射（如"靖哥"→"Jing Zhang"）
 * 走 Step 5:pinyin token 已在 allTerms 里（"靖"→"jing"+"qiao"等变体），
 * 命中的是 searchName 里有 "jing"/"zhang" 这类拼音 token 的用户。
 * 注意:这只能命中名字曾在 searchName 里被拼音化过的用户,不能把中文→拼音名做映射。
 * 真正"靖哥"→"Jing Zhang"的中文-英文名映射需要 UserAlias 表(本 PR 不在范围)。
 *
 * 运行：
 *   npx tsx scripts/test-user-search.ts
 */
import { loadEnvConfig } from "@next/env";
import { extractUserIdentifier } from "@/features/ai/core/resolvers/query-parser";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

interface TestCase {
  input: string;
  expectName: string;
  description: string;
}

const TESTS: TestCase[] = [
  { input: "jing",    expectName: "Jing Zhang",   description: "拼音 token → 命中" },
  { input: "min",    expectName: "许敏捷",         description: "名字拼音 token → 命中" },
  { input: "xu min", expectName: "许敏捷",         description: "拼音全拼（去空格）→ 命中" },
  { input: "maidy",  expectName: "maidy",         description: "纯英文小写 → 命中" },
  { input: "abb",    expectName: "AbbyChen",      description: "英文前缀 → 命中" },
  { input: "zzz",    expectName: "xbzzz",         description: "纯小写 token → 命中" },
  { input: "cary",   expectName: "cary（刘屹鹏）", description: "小写拼音名 → 命中" },
];

const IDENTIFIER_TESTS = [
  { input: "lhy的周报", expected: "lhy" },
  { input: "刘工的", expected: "刘工" },
  { input: "lhy", expected: "lhy" },
];

function testExtractedIdentifiers() {
  console.log("=== 用户标识提取验证 ===");
  let passed = 0;
  let failed = 0;

  for (const test of IDENTIFIER_TESTS) {
    const actual = extractUserIdentifier(test.input)?.normalized;
    if (actual === test.expected) {
      console.log(`  ✅ "${test.input}" → normalized="${actual}"`);
      passed++;
    } else {
      console.log(`  ❌ "${test.input}" → normalized="${actual ?? "undefined"}"（期望 "${test.expected}"）`);
      failed++;
    }
  }

  return { passed, failed };
}

async function searchUser(name: string) {
  return prisma.user.findFirst({
    where: { searchName: { contains: name, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true, searchName: true },
  });
}

async function main() {
  const identifierResults = testExtractedIdentifiers();
  console.log();
  console.log("=== 用户搜索字段匹配验证 ===\n");
  let passed = identifierResults.passed;
  let failed = identifierResults.failed;

  for (const tc of TESTS) {
    const result = await searchUser(tc.input);
    if (result && result.name === tc.expectName) {
      console.log(`  ✅ "${tc.input}" (${tc.description}) → 命中: "${result.name}"`);
      passed++;
    } else if (!result) {
      console.log(`  ❌ "${tc.input}" (${tc.description}) → 未命中！`);
      failed++;
    } else {
      console.log(`  ❌ "${tc.input}" (${tc.description}) → 错误命中: "${result.name}"（期望 "${tc.expectName}"）`);
      failed++;
    }
  }

  console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);

  // 打印 searchName 样本供参考
  console.log("\n=== searchName 样本 ===");
  const users = await prisma.user.findMany({
    take: 6,
    select: { name: true, searchName: true },
    orderBy: { createdAt: "asc" },
  });
  for (const u of users) {
    console.log(`  name="${u.name}" → searchName="${u.searchName}"`);
  }

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
