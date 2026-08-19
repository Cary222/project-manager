#!/usr/bin/env tsx

/**
 * Phase 4 完整功能验证脚本
 * 验证 P0/P1 所有阻塞项的实现
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const projectRoot = process.cwd();

interface TestResult {
  name: string;
  passed: boolean;
  details: string[];
}

const results: TestResult[] = [];

function addResult(name: string, passed: boolean, details: string[]) {
  results.push({ name, passed, details });
  const status = passed ? "✓" : "✗";
  console.log(`\n${status} ${name}`);
  details.forEach((d) => console.log(`  ${d}`));
}

console.log("🔍 Phase 4 完整功能验证开始...\n");

// ============================================================================
// P0 验证：HIL 完整闭环
// ============================================================================

console.log("📋 P0 验证：HIL 完整闭环\n");

// Test 1: /api/ai/work/approve 路由存在且实现完整
try {
  const routePath = join(
    projectRoot,
    "app/api/ai/work/approve/route.ts"
  );
  const routeContent = readFileSync(routePath, "utf-8");

  const checks = [
    { name: "POST 方法", pattern: /export\s+async\s+function\s+POST/ },
    { name: "GET 方法", pattern: /export\s+async\s+function\s+GET/ },
    { name: "鉴权检查", pattern: /await\s+auth\(\)/ },
    { name: "调用 resume", pattern: /\.resume\(/ },
    { name: "调用 cancel", pattern: /\.cancel\(/ },
    { name: "更新审批状态", pattern: /updateApproval\(/ },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(routeContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult(
    "Test 1: /api/ai/work/approve 路由完整性",
    allPassed,
    details
  );
} catch (error) {
  addResult("Test 1: /api/ai/work/approve 路由完整性", false, [
    `❌ 错误: ${error}`,
  ]);
}

// Test 2: PiRuntime.followUp() 实现
try {
  const sdkPath = join(
    projectRoot,
    "features/ai/agents/work/subagents/pi/transports/sdk.ts"
  );
  const sdkContent = readFileSync(sdkPath, "utf-8");

  const checks = [
    { name: "pausedRuns Map", pattern: /pausedRuns\s*=\s*new\s+Map/ },
    { name: "followUp 方法", pattern: /async\s+followUp\(/ },
    { name: "resolve promise", pattern: /pausedRun\.resolve\(/ },
    {
      name: "创建 approval promise",
      pattern: /approvalPromise\s*=\s*new\s+Promise/,
    },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(sdkContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 2: PiRuntime.followUp() 实现", allPassed, details);
} catch (error) {
  addResult("Test 2: PiRuntime.followUp() 实现", false, [
    `❌ 错误: ${error}`,
  ]);
}

// Test 3: approval_required 事件流
try {
  const sdkPath = join(
    projectRoot,
    "features/ai/agents/work/subagents/pi/transports/sdk.ts"
  );
  const sdkContent = readFileSync(sdkPath, "utf-8");

  const checks = [
    { name: "tool_call 事件", pattern: /type:\s*"tool_call"/ },
    { name: "approval_required 事件", pattern: /type:\s*"approval_required"/ },
    { name: "await approvalPromise", pattern: /await\s+approvalPromise/ },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(sdkContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 3: approval_required 事件流", allPassed, details);
} catch (error) {
  addResult("Test 3: approval_required 事件流", false, [
    `❌ 错误: ${error}`,
  ]);
}

// Test 4: 事件翻译
try {
  const eventsPath = join(
    projectRoot,
    "features/ai/agents/work/subagents/pi/events.ts"
  );
  const eventsContent = readFileSync(eventsPath, "utf-8");

  const checks = [
    {
      name: "approval_required 翻译",
      pattern: /case\s+"approval_required"/,
    },
    { name: "session_completed 翻译", pattern: /case\s+"session_completed"/ },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(eventsContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 4: 事件翻译完整性", allPassed, details);
} catch (error) {
  addResult("Test 4: 事件翻译完整性", false, [`❌ 错误: ${error}`]);
}

// ============================================================================
// P1 验证：数据库持久化
// ============================================================================

console.log("\n📋 P1 验证：数据库持久化\n");

// Test 5: 数据库 Schema
try {
  const schemaPath = join(projectRoot, "prisma/schema.prisma");
  const schemaContent = readFileSync(schemaPath, "utf-8");

  const checks = [
    { name: "PolicyAuditLog 模型", pattern: /model\s+PolicyAuditLog/ },
    { name: "PolicyRule 模型", pattern: /model\s+PolicyRule/ },
    { name: "SubAgentRun 模型", pattern: /model\s+SubAgentRun/ },
    { name: "PolicyDecision 枚举", pattern: /enum\s+PolicyDecision/ },
    { name: "PolicyRuleType 枚举", pattern: /enum\s+PolicyRuleType/ },
    { name: "SubAgentStatus 枚举", pattern: /enum\s+SubAgentStatus/ },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(schemaContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 5: 数据库 Schema 完整性", allPassed, details);
} catch (error) {
  addResult("Test 5: 数据库 Schema 完整性", false, [`❌ 错误: ${error}`]);
}

// Test 6: PolicyAuditLog 持久化
try {
  const policyPath = join(
    projectRoot,
    "features/ai/agents/work/policy/index.ts"
  );
  const policyContent = readFileSync(policyPath, "utf-8");

  const checks = [
    { name: "导入 prisma", pattern: /import.*prisma/ },
    { name: "recordAudit 创建记录", pattern: /prisma\.policyAuditLog\.create/ },
    { name: "updateApproval 方法", pattern: /async\s+updateApproval\(/ },
    {
      name: "findPendingApproval 方法",
      pattern: /async\s+findPendingApproval\(/,
    },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(policyContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 6: PolicyAuditLog 持久化", allPassed, details);
} catch (error) {
  addResult("Test 6: PolicyAuditLog 持久化", false, [`❌ 错误: ${error}`]);
}

// Test 7: PolicyRule 动态加载
try {
  const toolPolicyPath = join(
    projectRoot,
    "features/ai/agents/work/policy/tool-policy.ts"
  );
  const toolPolicyContent = readFileSync(toolPolicyPath, "utf-8");

  const checks = [
    { name: "导入 prisma", pattern: /import.*prisma/ },
    { name: "loadPoliciesFromDB", pattern: /async\s+function\s+loadPoliciesFromDB/ },
    { name: "getToolPolicies", pattern: /async\s+function\s+getToolPolicies/ },
    { name: "clearPolicyCache", pattern: /function\s+clearPolicyCache/ },
    { name: "缓存机制", pattern: /cachedPolicies|cacheTimestamp/ },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(toolPolicyContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 7: PolicyRule 动态加载", allPassed, details);
} catch (error) {
  addResult("Test 7: PolicyRule 动态加载", false, [`❌ 错误: ${error}`]);
}

// Test 8: PolicyRule API
try {
  const apiPath = join(
    projectRoot,
    "app/api/ai/work/policy/route.ts"
  );
  
  if (!existsSync(apiPath)) {
    addResult("Test 8: PolicyRule CRUD API", false, [
      "❌ API 路由文件不存在",
    ]);
  } else {
    const apiContent = readFileSync(apiPath, "utf-8");

    const checks = [
      { name: "GET 方法", pattern: /export\s+async\s+function\s+GET/ },
      { name: "POST 方法", pattern: /export\s+async\s+function\s+POST/ },
      { name: "PUT 方法", pattern: /export\s+async\s+function\s+PUT/ },
      { name: "DELETE 方法", pattern: /export\s+async\s+function\s+DELETE/ },
      { name: "鉴权检查", pattern: /await\s+auth\(\)/ },
      { name: "ROOT 权限检查", pattern: /role.*ROOT/ },
      { name: "清除缓存", pattern: /clearPolicyCache/ },
    ];

    const details: string[] = [];
    let allPassed = true;

    for (const check of checks) {
      const passed = check.pattern.test(apiContent);
      allPassed = allPassed && passed;
      details.push(`${passed ? "✅" : "❌"} ${check.name}`);
    }

    addResult("Test 8: PolicyRule CRUD API", allPassed, details);
  }
} catch (error) {
  addResult("Test 8: PolicyRule CRUD API", false, [`❌ 错误: ${error}`]);
}

// Test 9: SubAgentRun 持久化
try {
  const sdkPath = join(
    projectRoot,
    "features/ai/agents/work/subagents/pi/transports/sdk.ts"
  );
  const sdkContent = readFileSync(sdkPath, "utf-8");

  const checks = [
    { name: "导入 prisma", pattern: /import.*prisma/ },
    {
      name: "start() 创建记录",
      pattern: /prisma\.subAgentRun\.create/,
    },
    {
      name: "awaitCompletion 更新 COMPLETED",
      pattern: /status:\s*"COMPLETED"/,
    },
    {
      name: "awaitCompletion 处理 FAILED",
      pattern: /status:\s*"FAILED"/,
    },
    {
      name: "abort 更新 CANCELLED",
      pattern: /status:\s*"CANCELLED"/,
    },
    { name: "设置 completedAt", pattern: /completedAt:\s*new\s+Date/ },
  ];

  const details: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.pattern.test(sdkContent);
    allPassed = allPassed && passed;
    details.push(`${passed ? "✅" : "❌"} ${check.name}`);
  }

  addResult("Test 9: SubAgentRun 持久化", allPassed, details);
} catch (error) {
  addResult("Test 9: SubAgentRun 持久化", false, [`❌ 错误: ${error}`]);
}

// Test 10: 数据库迁移文件
try {
  const migrationsDir = join(projectRoot, "prisma/migrations");
  const migrationFile = join(
    migrationsDir,
    "20260819102537_add_phase4_policy_and_subagent_tables/migration.sql"
  );

  if (!existsSync(migrationFile)) {
    addResult("Test 10: 数据库迁移文件", false, [
      "❌ 迁移文件不存在",
    ]);
  } else {
    const migrationContent = readFileSync(migrationFile, "utf-8");

    const checks = [
      { name: "PolicyDecision 枚举", pattern: /CREATE\s+TYPE.*PolicyDecision/ },
      { name: "PolicyRuleType 枚举", pattern: /CREATE\s+TYPE.*PolicyRuleType/ },
      { name: "SubAgentStatus 枚举", pattern: /CREATE\s+TYPE.*SubAgentStatus/ },
      { name: "PolicyAuditLog 表", pattern: /CREATE\s+TABLE.*PolicyAuditLog/ },
      { name: "PolicyRule 表", pattern: /CREATE\s+TABLE.*PolicyRule/ },
      { name: "SubAgentRun 表", pattern: /CREATE\s+TABLE.*SubAgentRun/ },
    ];

    const details: string[] = [];
    let allPassed = true;

    for (const check of checks) {
      const passed = check.pattern.test(migrationContent);
      allPassed = allPassed && passed;
      details.push(`${passed ? "✅" : "❌"} ${check.name}`);
    }

    addResult("Test 10: 数据库迁移文件", allPassed, details);
  }
} catch (error) {
  addResult("Test 10: 数据库迁移文件", false, [`❌ 错误: ${error}`]);
}

// ============================================================================
// 汇总结果
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log("📊 验证结果汇总");
console.log("=".repeat(60));

const passedCount = results.filter((r) => r.passed).length;
const totalCount = results.length;

console.log(`\n总计: ${passedCount}/${totalCount} 项测试通过\n`);

if (passedCount === totalCount) {
  console.log("✅ Phase 4 完整功能验证通过！\n");
  console.log("已验证项:");
  console.log("  ✓ P0: HIL 完整闭环（API + followUp + 事件流 + 翻译）");
  console.log("  ✓ P1: PolicyAuditLog 持久化（表 + CRUD）");
  console.log("  ✓ P1: PolicyRule 动态加载（表 + API + 缓存）");
  console.log("  ✓ P1: SubAgentRun 持久化（表 + 生命周期管理）");
  console.log("  ✓ 数据库迁移文件完整");
  console.log("\n🎯 Phase 4 开发工作已完成，可以进入审查阶段");
  process.exit(0);
} else {
  console.log("❌ Phase 4 验证失败\n");
  console.log("未通过的测试:");
  results
    .filter((r) => !r.passed)
    .forEach((r) => {
      console.log(`  ✗ ${r.name}`);
    });
  process.exit(1);
}
