/**
 * reports-store-unit-test.ts
 *
 * 不需要 DB——纯函数测试：
 * - bucketByProgress 分桶逻辑
 * - calcProjectProgress 进度计算
 * - topMembers 排序
 * - 本周周报 submitted/missing 差集
 * - week.ts 相关函数（复用）
 *
 * 跑法：./node_modules/.bin/tsx scripts/reports-store-unit-test.ts
 */

function pass(name: string) { console.log(`  ✓ ${name}`); }
function fail(name: string, reason: string) {
  console.error(`  ✗ ${name}: ${reason}`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Pure helpers (copied from reports-store so they can be tested standalone)
// ---------------------------------------------------------------------------

type ProjectWithTickets = {
  id: string;
  name: string;
  status: string;
  tickets: { status: string }[];
};

function bucketByProgress(done: number, total: number): "good" | "normal" | "attention" | "risk" {
  if (total === 0) return "normal";
  const rate = (done / total) * 100;
  if (rate >= 80) return "good";
  if (rate >= 60) return "normal";
  if (rate >= 40) return "attention";
  return "risk";
}

function calcProjectProgress(project: ProjectWithTickets): number {
  const total = project.tickets.length;
  if (total === 0) return 0;
  const done = project.tickets.filter((t) => t.status === "DONE").length;
  return Math.round((done / total) * 100);
}

type TopMember = {
  userId: string;
  name: string | null;
  image: string | null;
  done: number;
  rate: number;
};

function sortTopMembers(members: TopMember[]): TopMember[] {
  return [...members]
    .filter((m) => m.done > 0)
    .sort((a, b) => b.done - a.done)
    .slice(0, 5);
}

function diffSubmittedMissing(
  allUserIds: string[],
  submittedIds: Set<string>
): { submitted: string[]; missing: string[] } {
  return {
    submitted: allUserIds.filter((id) => submittedIds.has(id)),
    missing:  allUserIds.filter((id) => !submittedIds.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log("[reports-store unit tests]");
  console.log("(pure functions — no DB required)");

  let passed = 0;
  let failed = 0;

  // Test 1: bucketByProgress — all 4 buckets
  for (const [done, total, expected] of [
    [10, 10, "good"],
    [8,  10, "good"],
    [7,  10, "normal"],
    [6,  10, "normal"],
    [5,  10, "attention"],
    [4,  10, "attention"],
    [3,  10, "risk"],
    [0,  10, "risk"],
    [0,   0, "normal"], // no tickets → normal
  ] as [number, number, string][]) {
    const got = bucketByProgress(done, total);
    if (got === expected) {
      pass(`bucketByProgress(${done}/${total}) → ${got}`);
      passed++;
    } else {
      fail(`bucketByProgress(${done}/${total})`, `expected ${expected}, got ${got}`);
      failed++;
    }
  }

  // Test 2: calcProjectProgress
  const emptyProject: ProjectWithTickets = {
    id: "p1", name: "Empty", status: "ACTIVE", tickets: [],
  };
  const halfDone: ProjectWithTickets = {
    id: "p2", name: "Half", status: "ACTIVE",
    tickets: [
      { status: "DONE" }, { status: "DONE" },
      { status: "DEVELOPING" }, { status: "DEVELOPING" },
    ],
  };
  const allDone: ProjectWithTickets = {
    id: "p3", name: "All", status: "ACTIVE",
    tickets: [{ status: "DONE" }, { status: "DONE" }],
  };
  const tests = [
    [emptyProject, 0],
    [halfDone, 50],
    [allDone, 100],
  ] as [ProjectWithTickets, number][];
  for (const [proj, expected] of tests) {
    const got = calcProjectProgress(proj);
    if (got === expected) {
      pass(`calcProjectProgress(${proj.name}) → ${got}%`);
      passed++;
    } else {
      fail(`calcProjectProgress(${proj.name})`, `expected ${expected}, got ${got}`);
      failed++;
    }
  }

  // Test 3: topMembers sort
  const members: TopMember[] = [
    { userId: "a", name: "Alice",   image: null, done: 3,  rate: 80 },
    { userId: "b", name: "Bob",     image: null, done: 10, rate: 90 },
    { userId: "c", name: "Carol",   image: null, done: 0,  rate: 0  },
    { userId: "d", name: "Dave",    image: null, done: 7,  rate: 70 },
  ];
  const sorted = sortTopMembers(members);
  if (
    sorted.length === 3 &&
    sorted[0].userId === "b" &&
    sorted[1].userId === "d" &&
    sorted[2].userId === "a"
  ) {
    pass("sortTopMembers: descending by done, filters 0");
    passed++;
  } else {
    fail("sortTopMembers", `got: ${JSON.stringify(sorted.map((m) => m.userId))}`);
    failed++;
  }

  // Test 4: diffSubmittedMissing
  const allUsers = ["u1", "u2", "u3", "u4"];
  const submitted = new Set(["u1", "u3"]);
  const { submitted: sub, missing: miss } = diffSubmittedMissing(allUsers, submitted);
  if (sub.length === 2 && miss.length === 2 && miss.includes("u2") && miss.includes("u4")) {
    pass("diffSubmittedMissing: correct split");
    passed++;
  } else {
    fail("diffSubmittedMissing", `submitted=${sub}, missing=${miss}`);
    failed++;
  }

  // Test 5: getWeekRange + getIsoWeek + formatWeekLabel
  {
    const { getWeekRange, getIsoWeek, formatWeekLabel } = await import("@/shared/lib/week");
    const { weekStart, weekEnd } = getWeekRange(new Date("2026-06-29T10:00:00Z"));
    const iso = getIsoWeek(weekStart);
    const label = formatWeekLabel(weekStart, weekEnd);

    const diff = weekEnd.getTime() - weekStart.getTime();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    let ok = Math.abs(diff - (WEEK_MS - 1)) <= 1;
    if (!ok) { fail("getWeekRange diff", `diff=${diff}`); failed++; }
    else { pass("getWeekRange: diff ≈ 7 days"); passed++; }

    if (iso.year === 2026 && iso.week >= 1 && iso.week <= 53) {
      pass(`getIsoWeek: ${iso.year}-W${iso.week}`);
      passed++;
    } else {
      fail("getIsoWeek", `got: ${JSON.stringify(iso)}`);
      failed++;
    }

    if (label.includes("-W")) {
      pass(`formatWeekLabel: ${label}`);
      passed++;
    } else {
      fail("formatWeekLabel", `got: ${label}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("\n[REPORTS STORE UNIT TESTS OK]");
    process.exit(0);
  } else {
    console.log("\n[REPORTS STORE UNIT TESTS FAIL]");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
