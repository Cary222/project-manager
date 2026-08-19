/**
 * Phase 2 验证脚本
 *
 * 验证 PiSubAgent 的核心功能：
 * 1. PiSubAgent.start() 能返回 handle
 * 2. translateEvents() 能输出 SubAgentEvent
 * 3. injectRuntimeContext() 能创建 .projecthub/AGENT_CONTEXT.md
 */

import path from "path";
import fs from "fs/promises";

// ============================================================================
// Mock imports（模拟运行环境）
// ============================================================================

const TEST_WORKSPACE = path.join(__dirname, "..", ".test-workspace");

async function setupTestWorkspace(): Promise<string> {
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });
  return TEST_WORKSPACE;
}

async function cleanupTestWorkspace(): Promise<void> {
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ============================================================================
// Test: types.ts
// ============================================================================

async function testTypes(): Promise<boolean> {
  console.log("\n📋 Test 1: 验证 types.ts 类型定义...");

  try {
    // 读取文件验证类型定义存在
    const typesContent = await fs.readFile(
      path.join(__dirname, "..", "features", "ai", "agents", "work", "subagents", "types.ts"),
      "utf-8"
    );

    // 验证核心类型定义存在
    const requiredTypes = [
      "export interface SubAgentRun",
      "export interface BaseSubAgent",
      "export type SubAgentEvent",
      "export interface SubAgentHandle",
      "export interface SubAgentResult",
      "export interface SubAgentInput",
      "export interface PolicyContext",
      "export interface PolicyResult",
      "export type PolicyDecision",
      "export type SubAgentStatus",
    ];

    for (const typeDef of requiredTypes) {
      if (!typesContent.includes(typeDef)) {
        console.error(`  ❌ 缺少类型定义: ${typeDef}`);
        return false;
      }
    }

    console.log("  ✅ types.ts 所有核心类型已定义");
    return true;
  } catch (err) {
    console.error("  ❌ types.ts 验证失败:", err);
    return false;
  }
}

// ============================================================================
// Test: PiSubAgent.start()
// ============================================================================

async function testPiSubAgentStart(): Promise<boolean> {
  console.log("\n🚀 Test 2: 验证 PiSubAgent.start()...");

  try {
    const { getPiSubAgent } = await import("../../features/ai/agents/work/subagents/pi/subagent");

    const piAgent = getPiSubAgent();

    // 创建 SubAgentRun
    const run = {
      runId: `test-${Date.now()}`,
      agentType: "pi" as const,
      workspaceId: "test-user",
      sessionId: "",
      status: "pending" as const,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 创建 SubAgentInput
    const input = {
      prompt: "帮我重构 ticket 模块",
      workspace: TEST_WORKSPACE,
      contextFiles: [],
    };

    // 启动 Pi session
    const handle = await piAgent.start(run, input);

    // 验证 handle
    if (!handle.runId) {
      console.error("  ❌ handle.runId 为空");
      return false;
    }

    if (!handle.sessionId) {
      console.error("  ❌ handle.sessionId 为空");
      return false;
    }

    if (!handle.events) {
      console.error("  ❌ handle.events 为空");
      return false;
    }

    if (!handle.cancel) {
      console.error("  ❌ handle.cancel 未定义");
      return false;
    }

    console.log(`  ✅ PiSubAgent.start() 返回有效 handle`);
    console.log(`     - runId: ${handle.runId}`);
    console.log(`     - sessionId: ${handle.sessionId}`);

    return true;
  } catch (err) {
    console.error("  ❌ PiSubAgent.start() 失败:", err);
    return false;
  }
}

// ============================================================================
// Test: translateEvents()
// ============================================================================

async function testTranslateEvents(): Promise<boolean> {
  console.log("\n🔄 Test 3: 验证 translateEvents()...");

  try {
    const { translateEvents } = await import("../../features/ai/agents/work/subagents/pi/events");

    const runId = `test-${Date.now()}`;

    // 创建一个空的事件流（mock Pi events）
    async function* emptyEvents() {
      // empty
    }

    const events = translateEvents(runId, emptyEvents());

    // 消费第一个事件
    const iterator = events[Symbol.asyncIterator]();
    const firstEvent = await iterator.next();

    if (firstEvent.done) {
      console.error("  ❌ 事件流为空");
      return false;
    }

    // 验证事件类型
    const event = firstEvent.value;
    if (!event.type) {
      console.error("  ❌ 事件缺少 type 字段");
      return false;
    }

    console.log(`  ✅ translateEvents() 能输出 SubAgentEvent`);
    console.log(`     - 第一个事件类型: ${event.type}`);
    console.log(`     - runId: ${event.runId}`);

    return true;
  } catch (err) {
    console.error("  ❌ translateEvents() 失败:", err);
    return false;
  }
}

// ============================================================================
// Test: injectRuntimeContext()
// ============================================================================

async function testInjectRuntimeContext(): Promise<boolean> {
  console.log("\n📝 Test 4: 验证 injectRuntimeContext()...");

  try {
    const { injectRuntimeContext, getContextFilePath } = await import(
      "../../features/ai/agents/work/subagents/pi/context"
    );

    // 注入上下文
    await injectRuntimeContext(
      {
        prompt: "帮我重构 ticket 模块",
        workspace: TEST_WORKSPACE,
        contextFiles: [],
      },
      {
        runId: `test-${Date.now()}`,
        userId: "test-user-id",
        userName: "Test User",
      }
    );

    // 验证文件已创建
    const contextFile = getContextFilePath(TEST_WORKSPACE);
    const content = await fs.readFile(contextFile, "utf-8");

    if (!content.includes("ProjectHub Runtime Context")) {
      console.error("  ❌ AGENT_CONTEXT.md 内容不正确");
      return false;
    }

    if (!content.includes("test-user-id")) {
      console.error("  ❌ AGENT_CONTEXT.md 缺少 userId");
      return false;
    }

    if (!content.includes("帮我重构 ticket 模块")) {
      console.error("  ❌ AGENT_CONTEXT.md 缺少 prompt");
      return false;
    }

    console.log(`  ✅ injectRuntimeContext() 成功创建 .projecthub/AGENT_CONTEXT.md`);
    console.log(`     - 文件路径: ${contextFile}`);

    return true;
  } catch (err) {
    console.error("  ❌ injectRuntimeContext() 失败:", err);
    return false;
  }
}

// ============================================================================
// Test: graph.ts 修改
// ============================================================================

async function testGraphChanges(): Promise<boolean> {
  console.log("\n🕸️ Test 5: 验证 graph.ts 修改...");

  try {
    const { getWorkAgentGraph } = await import("../../features/ai/agents/work/graph");

    const graph = getWorkAgentGraph();

    if (!graph) {
      console.error("  ❌ getWorkAgentGraph() 返回 null");
      return false;
    }

    console.log(`  ✅ getWorkAgentGraph() 返回有效 graph`);

    return true;
  } catch (err) {
    console.error("  ❌ graph.ts 验证失败:", err);
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("Phase 2 验证脚本");
  console.log("=".repeat(60));

  // Setup
  await setupTestWorkspace();

  const results: { name: string; passed: boolean }[] = [];

  try {
    // 运行测试
    results.push({ name: "types.ts", passed: await testTypes() });
    results.push({ name: "PiSubAgent.start()", passed: await testPiSubAgentStart() });
    results.push({ name: "translateEvents()", passed: await testTranslateEvents() });
    results.push({ name: "injectRuntimeContext()", passed: await testInjectRuntimeContext() });
    results.push({ name: "graph.ts 修改", passed: await testGraphChanges() });

    // 输出结果
    console.log("\n" + "=".repeat(60));
    console.log("验证结果汇总");
    console.log("=".repeat(60));

    const allPassed = results.every((r) => r.passed);

    for (const result of results) {
      console.log(`  ${result.passed ? "✅" : "❌"} ${result.name}`);
    }

    console.log("\n" + "-".repeat(60));
    if (allPassed) {
      console.log("🎉 所有验证通过！Phase 2 基础设施已就绪。");
    } else {
      console.error("❌ 部分验证失败，请检查上述错误。");
      process.exit(1);
    }
  } finally {
    // Cleanup
    await cleanupTestWorkspace();
  }
}

main().catch((err) => {
  console.error("验证脚本执行失败:", err);
  process.exit(1);
});
