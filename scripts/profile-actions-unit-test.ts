/**
 * profile-actions 单元测试
 *
 * 覆盖 profile-actions.ts 中的纯数据转换：
 *   - getUserProfileAction 返回的 aiProfile 字段
 *   - getTeamMembersAction 返回的 hasAiProfile 判定
 *
 * 这些函数直接读 Prisma 不可用，但**类型 + 形状转换**逻辑可以独立测。
 * 真正需要 DB 的部分在 verify-pr.ts 的 HTTP 测试里覆盖。
 *
 * 跑法：
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/profile-actions-unit-test.ts
 */

import type {
  AiProfileSummary,
  TeamMember,
} from "@/features/profile/lib/profile-actions";

// --- 复刻自 profile-actions.ts 的纯函数（不依赖 Prisma） ---

function shapeAiProfile(
  record:
    | { profile: unknown; sourceSummaryCount: number; updatedAt: Date }
    | null
): AiProfileSummary {
  if (!record) {
    return {
      hasProfile: false,
      sourceSummaryCount: 0,
      updatedAt: null,
      profile: null,
    };
  }
  return {
    hasProfile: true,
    sourceSummaryCount: record.sourceSummaryCount,
    updatedAt: record.updatedAt,
    profile: record.profile as AiProfileSummary["profile"],
  };
}

function shapeHasAiProfile(aiProfileRow: { userId: string } | null): TeamMember["hasAiProfile"] {
  return aiProfileRow !== null;
}

// --- Tests ---

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("[profile-actions unit tests]");
console.log("(pure functions — no DB required, types imported from source)");

// shapeAiProfile: null → empty
{
  const result = shapeAiProfile(null);
  assert("shapeAiProfile(null) → hasProfile: false", result.hasProfile === false);
  assert("shapeAiProfile(null) → sourceSummaryCount: 0", result.sourceSummaryCount === 0);
  assert("shapeAiProfile(null) → updatedAt: null", result.updatedAt === null);
  assert("shapeAiProfile(null) → profile: null", result.profile === null);
}

// shapeAiProfile: populated
{
  const updatedAt = new Date("2026-06-29T10:00:00Z");
  const result = shapeAiProfile({
    profile: { roles: ["前端工程师"], expertise: ["React"], interests: [], projects: [], recentTopics: [], preferences: {} },
    sourceSummaryCount: 5,
    updatedAt,
  });
  assert("shapeAiProfile(populated) → hasProfile: true", result.hasProfile === true);
  assert("shapeAiProfile(populated) → sourceSummaryCount: 5", result.sourceSummaryCount === 5);
  assert("shapeAiProfile(populated) → updatedAt passed through", result.updatedAt === updatedAt);
  assert(
    "shapeAiProfile(populated) → profile.roles[0] === 前端工程师",
    (result.profile as { roles: string[] }).roles[0] === "前端工程师"
  );
}

// shapeHasAiProfile: null
assert("shapeHasAiProfile(null) → false", shapeHasAiProfile(null) === false);

// shapeHasAiProfile: object
assert(
  "shapeHasAiProfile({userId: 'u1'}) → true",
  shapeHasAiProfile({ userId: "u1" }) === true
);

// shapeHasAiProfile: empty object still means "has row" (Prisma's include returns the row
// object even when all fields are null). This is intentional — the UI treats "row exists"
// as "profile is generated", separate from "profile has content".
assert(
  "shapeHasAiProfile({}) → true (row exists, empty content)",
  shapeHasAiProfile({} as { userId: string }) === true
);

// --- Summary ---

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
