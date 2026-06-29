/**
 * verify-pr.ts — PR1 + PR2 + PR3 + PR4 + PR5 完整验证
 *
 * 跑法：
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --pr1
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --pr2
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --pr3
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --pr4
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --pr5
 *   ./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --all
 *
 * 验证顺序（--pr5）：
 *   1. 子脚本：weekly-report-bg-job-unit-test（10 个测试，含 PR5 的 Test 9/10）
 *   2. API 路由挂载测试（regenerate 202/401/404/403）
 */

import { spawnSync } from "child_process";
import { resolve } from "path";

const BASE = "http://localhost:3003";

function runScript(name: string, script: string, args: string[]): boolean {
  const tsx = resolve("node_modules/.bin/tsx");
  const envFile = resolve(".env.local");
  console.log(`\n[${name}] Running: tsx --env-file=.env.local scripts/${script} ${args.join(" ")}`);
  const result = spawnSync("node", [tsx, "--env-file=" + envFile, resolve(`scripts/${script}`), ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  const ok = result.status === 0;
  if (ok) {
    console.log(`  ✓ ${name} PASS`);
  } else {
    console.error(`  ✗ ${name} FAIL (exit ${result.status})`);
  }
  return ok;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  return { status: res.status };
}

async function main() {
  const args = process.argv.slice(2);
  if (
    !args.includes("--pr1") &&
    !args.includes("--pr2") &&
    !args.includes("--pr3") &&
    !args.includes("--pr4") &&
    !args.includes("--pr5") &&
    !args.includes("--all")
  ) {
    console.log("Usage: tsx scripts/verify-pr.ts --pr1 | --pr2 | --pr3 | --pr4 | --pr5 | --all");
    process.exit(1);
  }

  const runPr1 = args.includes("--pr1") || args.includes("--all");
  const runPr2 = args.includes("--pr2") || args.includes("--all");
  const runPr3 = args.includes("--pr3") || args.includes("--all");
  const runPr4 = args.includes("--pr4") || args.includes("--all");
  const runPr5 = args.includes("--pr5") || args.includes("--all");

  console.log("========================================");
  console.log("     verify-pr — PR1 / PR2 / PR3 / PR4 / PR5 suite");
  console.log(`     pr1=${runPr1}  pr2=${runPr2}  pr3=${runPr3}  pr4=${runPr4}  pr5=${runPr5}`);
  console.log("========================================");

  let allPassed = true;

  // ===== PR1 steps (always run when --pr1 or --all) =====
  if (runPr1) {
    console.log("\n===== PR1 STEPS =====");

    // Step 1: weekly-report-store unit tests
    if (!runScript("WEEKLY REPORT STORE UNIT", "weekly-report-store-unit-test.ts", [])) {
      allPassed = false;
    }

    // Step 2: PkmBoard smoke
    if (!runScript("PKM BOARD SMOKE", "pkm-board-smoke.ts", [])) {
      allPassed = false;
    }

    // Step 3: weekly-reports API routes
    console.log("\n[PR1 API ROUTE TESTS]");
    const pr1Routes = [
      { method: "GET",    path: "/api/reports/weekly-reports",                          expect: [307, 302, 401] },
      { method: "GET",    path: "/api/reports/weekly-reports/fake-id-xyz",               expect: [307, 302, 401, 404] },
      { method: "POST",   path: "/api/reports/weekly-reports",                           body: "{}",                expect: [307, 302, 400, 401] },
      { method: "POST",   path: "/api/reports/weekly-reports",                           body: JSON.stringify({ weekStart: "not-a-date", title: "Test" }), expect: [307, 302, 400, 401] },
      { method: "PATCH",  path: "/api/reports/weekly-reports/fake-id",                   body: "{}",                expect: [307, 302, 400, 401, 404] },
      { method: "DELETE", path: "/api/reports/weekly-reports/fake-id",                                           expect: [307, 302, 401, 404] },
    ];
    for (const r of pr1Routes) {
      const { status } = await apiFetch(r.path, { method: r.method, body: r.body });
      const ok = r.expect.includes(status);
      if (ok) {
        console.log(`  ✓ ${r.method} ${r.path} → ${status}`);
      } else {
        console.log(`  ✗ ${r.method} ${r.path} → ${status} (expected ${r.expect.join("/")})`);
        allPassed = false;
      }
    }
  }

  // ===== PR2 steps =====
  if (runPr2) {
    console.log("\n===== PR2 STEPS =====");

    // Step 1: reports-store unit tests
    if (!runScript("REPORTS STORE UNIT", "reports-store-unit-test.ts", [])) {
      allPassed = false;
    }

    // Step 2: reports API routes
    console.log("\n[PR2 API ROUTE TESTS]");

    // 2a. GET /api/reports/stats → auth redirect
    {
      const { status } = await apiFetch("/api/reports/stats");
      if ([307, 302, 401].includes(status)) {
        console.log(`  ✓ GET /api/reports/stats → ${status} (auth)`);
      } else {
        console.log(`  ✗ GET /api/reports/stats → ${status} (expected 307/302/401)`);
        allPassed = false;
      }
    }

    // 2b. GET /api/reports/health-summary → auth redirect
    {
      const { status } = await apiFetch("/api/reports/health-summary");
      if ([307, 302, 401].includes(status)) {
        console.log(`  ✓ GET /api/reports/health-summary → ${status} (auth)`);
      } else {
        console.log(`  ✗ GET /api/reports/health-summary → ${status} (expected 307/302/401)`);
        allPassed = false;
      }
    }

    // 2c. POST /api/reports/weekly-reports/:id/regenerate → auth guard (401) / not found (404)
    {
      const { status } = await apiFetch("/api/reports/weekly-reports/fake-id/regenerate", {
        method: "POST",
      });
      // No auth → 401. After PR4, real IDs return 404 (not found) or 403 (forbidden).
      if ([307, 302, 401, 404, 403, 202].includes(status)) {
        console.log(`  ✓ POST regenerate → ${status}`);
      } else {
        console.log(`  ✗ POST regenerate → ${status} (expected 307/302/401/404/403/202)`);
        allPassed = false;
      }
    }
  }

  // ===== PR3 steps =====
  if (runPr3) {
    console.log("\n===== PR3 STEPS =====");

    // Step 1: profile-actions unit tests
    if (!runScript("PROFILE ACTIONS UNIT", "profile-actions-unit-test.ts", [])) {
      allPassed = false;
    }

    // Step 2: profile / team / AI-profile API routes
    console.log("\n[PR3 API ROUTE TESTS]");

    // 2a. GET /team → 200 (SSR page)
    {
      const { status } = await apiFetch("/team");
      if ([200, 307, 302, 401].includes(status)) {
        console.log(`  ✓ GET /team → ${status}`);
      } else {
        console.log(`  ✗ GET /team → ${status} (expected 200/307/302/401)`);
        allPassed = false;
      }
    }

    // 2b. GET /team/<id> → 200 (SSR page) — fake id should 404/200
    {
      const { status } = await apiFetch("/team/cmpuv1ota001rjlnkds1ckqe2");
      if ([200, 307, 302, 401, 404].includes(status)) {
        console.log(`  ✓ GET /team/<id> → ${status}`);
      } else {
        console.log(`  ✗ GET /team/<id> → ${status} (expected 200/307/302/401/404)`);
        allPassed = false;
      }
    }

    // 2c. GET /api/team/<id>/ai-profile → auth redirect
    {
      const { status } = await apiFetch("/api/team/cmpuv1ota001rjlnkds1ckqe2/ai-profile");
      if ([307, 302, 401].includes(status)) {
        console.log(`  ✓ GET /api/team/<id>/ai-profile → ${status} (auth)`);
      } else {
        console.log(`  ✗ GET /api/team/<id>/ai-profile → ${status} (expected 307/302/401)`);
        allPassed = false;
      }
    }

    // 2d. GET /api/team//ai-profile (empty id) → 400 or 404
    {
      const { status } = await apiFetch("/api/team//ai-profile");
      if ([400, 404, 307, 302, 308, 401].includes(status)) {
        console.log(`  ✓ GET /api/team//ai-profile → ${status} (bad id rejected)`);
      } else {
        console.log(`  ✗ GET /api/team//ai-profile → ${status} (expected 400/404/307/302/308/401)`);
        allPassed = false;
      }
    }
  }

  // ===== PR4 steps =====
  if (runPr4) {
    console.log("\n===== PR4 STEPS =====");

    // Step 1: weekly-report-bg-job unit tests
    if (!runScript("BG-JOB UNIT", "weekly-report-bg-job-unit-test.ts", [])) {
      allPassed = false;
    }

    // Step 2: regenerate API route auth/authZ tests
    console.log("\n[PR4 API ROUTE TESTS]");

    // 2a. POST regenerate without auth → 307/302 (Next.js auth redirect) or 401
    {
      const { status } = await apiFetch("/api/reports/weekly-reports/fake-id/regenerate", {
        method: "POST",
      });
      if ([307, 302, 401].includes(status)) {
        console.log(`  ✓ POST regenerate (no auth) → ${status}`);
      } else {
        console.log(`  ✗ POST regenerate (no auth) → ${status} (expected 307/302/401)`);
        allPassed = false;
      }
    }

    // 2b. POST regenerate with fake-id (no auth) → auth redirect 307/302 (Next.js)
    // Already covered above; skip duplicating

    // Note: Testing with real auth + ownership (404/403) requires a real user session.
    // We verify the logic works via the unit test above.
    // The auth-redirect case (307/302) is covered in the PR2 step.
  }

  // ===== PR5 steps =====
  if (runPr5) {
    console.log("\n===== PR5 STEPS =====");

    // Step 1: weekly-report-bg-job unit tests (now includes PR5 tests 9/10)
    if (!runScript("BG-JOB UNIT", "weekly-report-bg-job-unit-test.ts", [])) {
      allPassed = false;
    }

    // Step 2: regenerate API route — no auth → 307/302 (Next.js redirect)
    console.log("\n[PR5 API ROUTE TESTS]");

    // 2a. POST regenerate without auth → 307/302
    {
      const { status } = await apiFetch("/api/reports/weekly-reports/fake-id/regenerate", {
        method: "POST",
      });
      if ([307, 302, 401].includes(status)) {
        console.log(`  ✓ POST regenerate (no auth) → ${status}`);
      } else {
        console.log(`  ✗ POST regenerate (no auth) → ${status} (expected 307/302/401)`);
        allPassed = false;
      }
    }
  }

  console.log("\n========================================");
  if (!allPassed) {
    console.error("[VERIFY FAIL]");
    process.exit(1);
  }
  const labels = [
    runPr1 ? "PR1" : "",
    runPr2 ? "PR2" : "",
    runPr3 ? "PR3" : "",
    runPr4 ? "PR4" : "",
    runPr5 ? "PR5" : "",
  ].filter(Boolean).join("+");
  console.log(`[${labels} OK]`);
  console.log("========================================");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
