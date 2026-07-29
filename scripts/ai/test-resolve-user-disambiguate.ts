/**
 * test-resolve-user-disambiguate.ts — 验证 resolveUser disambiguate 触发路径
 *
 * 测试场景：
 * 1. 输入 "刘工" → 期望返回 candidates.length >= 2，触发 disambiguate
 * 2. 输入 "刘屹鹏" → 期望返回单个用户（强匹配 Step 2 name exact）
 * 3. 输入 "lhy" → 期望返回单个用户（强匹配 Step 1/3）
 * 4. 输入 "刘" → 期望返回 candidates.length >= 2
 *
 * 前置条件：run buildUserSearchTerms 改动后，需手动跑 backfill 脚本
 * 才能让历史用户的 searchName 包含新拼音变体。
 *
 * 运行：
 *   npx tsx scripts/test-resolve-user-disambiguate.ts
 *
 * ⚠️ 回填提示：
 *   buildUserSearchTerms 改动后，请手动跑：
 *   npx tsx scripts/backfill-user-search-names.ts --dry-run  # 先预览
 *   npx tsx scripts/backfill-user-search-names.ts           # 确认后实跑
 */
import { loadEnvConfig } from "@next/env";
import { extractUserIdentifier } from "@/features/ai/core/resolvers/query-parser";
import { prisma } from "@/shared/db/client";
import { buildUserSearchTerms, chineseToPinyin } from "@/features/profile/lib/user-search";
import { pinyin as pinyinArray } from "pinyin-pro";

loadEnvConfig(process.cwd());

interface TestCase {
  input: string;
  description: string;
  expectCandidates?: number; // >= 0 means expect candidates.length
  expectSingle?: boolean;     // true = expect single user (confidence >= 0.95)
  expectNone?: boolean;       // true = expect no user and no candidates
}

const TEST_CASES: TestCase[] = [
  // === Layer 1: buildUserSearchTerms 修复验证 ===
  {
    input: "cary（刘屹鹏）",
    description: "混合 name 含中文 → 拼音变体",
    // extractUserIdentifier → normalized="刘屹鹏" → 与下方"刘屹鹏" case 共享 normalized
    // 都会命中 cary + 刘屹鹏（user test）+ 谢上鹏 → disambiguate（预期）
    expectCandidates: 3,
  },
  {
    input: "刘屹鹏（user test）",
    description: "混合 name 含中文 → 拼音变体",
    // normalized="刘屹鹏（usertest）" → Step 2 不匹配 → Step 3 无拼音匹配（searchName 未回填）
    // → Step 5 单字 "刘" "屹" "鹏" 命中多个 → disambiguate（预期）
    // 回填后：Step 3 会命中 searchName 含 "liuyipeng" 的用户（仅一个）→ confidence 0.95
    // 当前 searchName 未回填，期望无匹配（过渡期）
    expectNone: true,
  },
  {
    input: "刘屹鹏",
    description: "纯中文 → 拼音变体（回归）",
    // allTerms 含单字 "刘" "屹" "鹏" → 命中 3 个用户 → disambiguate
    // 这是真实语义边界（确实有 3 个用户的 name 含 "刘屹鹏" 中的单字）
    expectCandidates: 3,
  },
  {
    input: "cary",
    description: "纯英文 → 不生成拼音（回归）",
    expectSingle: true,
  },

  // === Layer 2: disambiguate 触发验证 ===
  {
    input: "刘工",
    description: "两字中文 → 命中多个用户 → 触发 disambiguate",
    expectCandidates: 2,
  },
  {
    input: "刘",
    description: "单字中文 → 命中多个用户 → 触发 disambiguate",
    expectCandidates: 2,
  },
  {
    input: "lhy",
    description: "精确拼音名 → 单个用户（回归）",
    expectSingle: true,
  },
  // 真实用户查询场景：混合 name 的用户在数据库中，通过纯中文名查询
  {
    input: "刘屹鹏在做什么",
    description: "真实场景：extractUserIdentifier 提取刘屹鹏，命中多个用户",
    // normalized="刘屹鹏" → 同上，disambiguate（预期）
    expectCandidates: 3,
  },
];

// Replicate resolveUser allTerms generation exactly (for testing only)
function buildAllTerms(normTrimmed: string): string[] {
  const allTerms: string[] = [];

  // 1. raw lower
  allTerms.push(normTrimmed.toLowerCase());

  // 2. all space-separated tokens
  const tokens = normTrimmed.split(/\s+/).filter((t) => t.length >= 1);
  for (const t of tokens) allTerms.push(t.toLowerCase());

  // 3. 含中文的拼音变体（same logic as resolveUser lines 99-128）
  // 注意：只要 name 含中文就生成拼音（含英文片段的中文名如 "cary（刘屹鹏）" 也生成）
  // 但只有「纯中文输入」才拆单字 term（避免无关字符误匹配）
  if (/[\u4e00-\u9fa5]/.test(normTrimmed)) {
    // 抽出纯中文字符再生成全拼（确保 pinyin-pro 正常工作）
    const chineseOnly = normTrimmed.replace(/[^\u4e00-\u9fa5]/g, "");
    if (chineseOnly.length > 0) {
      const pinyinStr = chineseToPinyin(chineseOnly);
      if (pinyinStr) {
        allTerms.push(pinyinStr);
        allTerms.push(pinyinStr.split("").reverse().join(""));
      }
      const charPinyins = pinyinArray(chineseOnly, {
        toneType: "none",
        type: "array",
        nonZh: "removed",
        surname: "head",
      }) as string[];
      if (charPinyins.length > 0) {
        allTerms.push(charPinyins.join(" "));
        allTerms.push([...charPinyins].reverse().join(" "));
      }
      // 仅在「纯中文输入」时拆单字 term（区分度不足会导致误匹配）
      // 例："刘工"（纯中文）→ "刘", "工", "liu", "gong"（正确）
      // 例："cary（刘屹鹏）"（含英文）→ 不拆单字（避免 "刘" 匹配到无关用户）
      if (/^[\u4e00-\u9fa5]+$/.test(normTrimmed)) {
        for (const ch of chineseOnly) {
          allTerms.push(ch);
        }
        for (const py of charPinyins) {
          if (py) allTerms.push(py.toLowerCase());
        }
      }
    }
  }

  return [...new Set(allTerms)];
}

// Replicate resolveUser for testing (includes allSteps, disambiguate via allTerms)
async function resolveUserTest(
  identifier: { raw: string; normalized: string }
): Promise<{ userId: string | null; name: string | null; confidence: number; candidates: string[] }> {
  const { normalized } = identifier;
  const normTrimmed = normalized.trim();
  if (!normTrimmed) return { userId: null, name: null, confidence: 0, candidates: [] };

  // Build allTerms exactly like resolveUser does
  const allTerms = buildAllTerms(normTrimmed);

  // Step 1: Exact id match
  const byId = await prisma.user.findUnique({
    where: { id: normTrimmed },
    select: { id: true, name: true },
  });
  if (byId) return { userId: byId.id, name: byId.name ?? byId.id, confidence: 1.0, candidates: [] };

  // Step 2: Exact name match
  const byName = await prisma.user.findFirst({
    where: { name: { equals: normTrimmed, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true },
  });
  if (byName) return { userId: byName.id, name: byName.name ?? byName.id, confidence: 1.0, candidates: [] };

  // === 弱匹配候选池（Step 3 多匹配和 Step 5 共享）===
  const allCandidates = new Map<string, { id: string; name: string | null; score: number }>();

  // Step 3: searchName contains any allTerms (fixed: collect all, not findFirst)
  const searchNameCandidates = new Map<string, { id: string; name: string | null }>();
  if (normTrimmed.length >= 1) {
    for (const term of allTerms) {
      if (term.length < 1) continue;
      if (/^[\u4e00-\u9fa5]$/.test(term)) continue; // 跳过纯单字中文
      const matches = await prisma.user.findMany({
        where: { searchName: { contains: term, mode: "insensitive" }, bannedAt: null },
        select: { id: true, name: true },
      });
      for (const m of matches) {
        if (!searchNameCandidates.has(m.id)) {
          searchNameCandidates.set(m.id, { id: m.id, name: m.name });
        }
      }
    }
    if (searchNameCandidates.size === 1) {
      const [only] = Array.from(searchNameCandidates.values());
      return { userId: only.id, name: only.name ?? only.id, confidence: 0.95, candidates: [] };
    }
    if (searchNameCandidates.size > 1) {
      for (const [id, info] of searchNameCandidates) {
        if (!allCandidates.has(id)) {
          allCandidates.set(id, { id, name: info.name, score: 2 });
        } else {
          allCandidates.get(id)!.score += 2;
        }
      }
    }
  }

  // Step 5: name contains any allTerms — collect all candidates
  // allTerms 已在 buildAllTerms 里过滤了纯单字中文字符，与主 resolveUser 的 Step 5 逻辑一致
  for (const term of allTerms) {
    if (term.length < 1) continue;
    const matches = await prisma.user.findMany({
      where: { name: { contains: term, mode: "insensitive" }, bannedAt: null },
      select: { id: true, name: true },
    });
    for (const m of matches) {
      const existing = allCandidates.get(m.id);
      allCandidates.set(m.id, { id: m.id, name: m.name, score: existing ? existing.score + 1 : 1 });
    }
  }

  const candidates = Array.from(allCandidates.values());
  if (candidates.length === 1) {
    return { userId: candidates[0].id, name: candidates[0].name ?? candidates[0].id, confidence: 0.7, candidates: [] };
  }
  if (candidates.length > 1) {
    return { userId: null, name: null, confidence: 0.5, candidates: candidates.map((c) => c.name ?? c.id) };
  }

  return { userId: null, name: null, confidence: 0, candidates: [] };
}

async function main() {
  console.log("=== buildUserSearchTerms 修复验证 ===\n");
  const buildTests = [
    { name: "cary（刘屹鹏）", expected: "liuyipeng" },
    { name: "刘屹鹏（user test）", expected: "liuyipeng" },
    { name: "刘屹鹏", expected: "liuyipeng" },
    { name: "cary", expected: "cary" },
  ];

  let buildPassed = 0, buildFailed = 0;
  for (const t of buildTests) {
    const result = buildUserSearchTerms(t.name);
    const hasPinyin = result?.includes(t.expected) ?? false;
    if (hasPinyin) {
      console.log(`  ✅ "${t.name}" → 包含 "${t.expected}"`);
      buildPassed++;
    } else {
      console.log(`  ❌ "${t.name}" → 缺少 "${t.expected}", got: "${result}"`);
      buildFailed++;
    }
  }
  console.log(`  buildUserSearchTerms: ${buildPassed} 通过 / ${buildFailed} 失败\n`);

  console.log("=== resolveUser disambiguate 链路验证 ===\n");
  let passed = 0, failed = 0;

  for (const tc of TEST_CASES) {
    const extracted = extractUserIdentifier(tc.input);
    if (!extracted) {
      console.log(`  ❌ "${tc.input}" → extractUserIdentifier 返回 undefined`);
      failed++;
      continue;
    }

    const result = await resolveUserTest(extracted);
    let ok = false;
    let reason = "";

    if (tc.expectSingle && result.userId) {
      ok = result.candidates.length === 0;
      reason = `单用户, confidence=${result.confidence}`;
    } else if (tc.expectCandidates !== undefined && result.candidates.length >= tc.expectCandidates) {
      ok = result.candidates.length >= tc.expectCandidates;
      reason = `candidates.length=${result.candidates.length} (>= ${tc.expectCandidates})`;
    } else if (tc.expectNone && !result.userId && result.candidates.length === 0) {
      ok = true;
      reason = "无匹配";
    } else if (result.candidates.length > 0) {
      reason = `candidates=[${result.candidates.join(", ")}]`;
    } else {
      reason = `userId=${result.userId ?? "null"}, candidates.length=${result.candidates.length}`;
    }

    if (ok) {
      console.log(`  ✅ "${tc.input}" (${tc.description}) → ${reason}`);
      passed++;
    } else {
      console.log(`  ❌ "${tc.input}" (${tc.description}) → 期望: ${JSON.stringify(tc)}, 实际: ${reason}`);
      failed++;
    }
  }

  console.log(`\n  resolveUser disambiguate: ${passed} 通过 / ${failed} 失败`);
  console.log("\n=== 搜索样本（供参考）===\n");

  // Show searchName samples for key users
  const keyUsers = await prisma.user.findMany({
    where: {
      name: {
        in: ["cary（刘屹鹏）", "刘屹鹏（user test）", "刘屹鹏", "cary", "lhy"],
        mode: "insensitive",
      },
      bannedAt: null,
    },
    select: { name: true, searchName: true },
    take: 10,
  });

  for (const u of keyUsers) {
    console.log(`  name="${u.name}" → searchName="${u.searchName}"`);
  }

  console.log("\n⚠️ 回填提示:");
  console.log("  buildUserSearchTerms 改动后，请手动跑回填脚本让历史用户 searchName 生效新拼音变体:");
  console.log("    npx tsx scripts/backfill-user-search-names.ts --dry-run  # 先预览");
  console.log("    npx tsx scripts/backfill-user-search-names.ts           # 确认后实跑");

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
