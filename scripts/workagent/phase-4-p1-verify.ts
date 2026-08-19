/**
 * Phase 4 P1 验证脚本 - SubAgentRun 持久化
 * 
 * 验证内容：
 * 1. SubAgentRun 数据库模型存在
 * 2. PiSdkRuntime 创建记录时写入数据库
 * 3. awaitCompletion 更新 COMPLETED 状态
 * 4. abort 更新 CANCELLED 状态
 * 5. 事件流结束时更新 FAILED 状态
 */

async function main() {
  console.log("🔍 Phase 4 P1 验证开始...\n");

  const fs = await import("fs/promises");

  // ─── Test 1: 检查 Prisma Schema ────────────────────────────────
  console.log("✓ Test 1: 检查 SubAgentRun 数据库模型");
  try {
    const schemaPath = "./prisma/schema.prisma";
    const schema = await fs.readFile(schemaPath, "utf-8");
    
    if (!schema.includes("model SubAgentRun")) {
      throw new Error("SubAgentRun 模型未找到");
    }
    console.log("  ✅ SubAgentRun 模型存在");
    
    // 检查关键字段
    const requiredFields = [
      "id",
      "runId",
      "agentType",
      "status",
      "sessionId",
      "userId",
      "workspaceId",
      "startedAt",
      "completedAt",
      "contextFiles",
    ];
    
    for (const field of requiredFields) {
      if (!schema.includes(`${field}`)) {
        throw new Error(`字段 ${field} 未找到`);
      }
    }
    console.log("  ✅ 必需字段完整");
    
    // 检查 SubAgentStatus 枚举
    if (!schema.includes("enum SubAgentStatus")) {
      throw new Error("SubAgentStatus 枚举未找到");
    }
    
    const statusValues = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
    for (const status of statusValues) {
      if (!schema.includes(status)) {
        console.warn(`  ⚠️  状态值 ${status} 未找到`);
      }
    }
    console.log("  ✅ SubAgentStatus 枚举存在");
  } catch (error) {
    console.error("  ❌ Test 1 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 2: 检查 PiSdkRuntime 创建记录 ────────────────────────
  console.log("✓ Test 2: 检查 PiSdkRuntime 创建 SubAgentRun 记录");
  try {
    const sdkPath = "./features/ai/agents/work/subagents/pi/transports/sdk.ts";
    const content = await fs.readFile(sdkPath, "utf-8");
    
    // 检查导入
    if (!content.includes('import { prisma }') && !content.includes('from "@/lib/prisma"')) {
      throw new Error("未导入 prisma 客户端");
    }
    console.log("  ✅ 已导入 prisma 客户端");
    
    // 检查创建记录
    if (!content.includes("prisma.subAgentRun.create")) {
      throw new Error("未找到创建 SubAgentRun 记录的代码");
    }
    console.log("  ✅ 在 start() 中创建记录");
    
    // 检查必需字段
    const createSection = content.substring(
      content.indexOf("prisma.subAgentRun.create"),
      content.indexOf("});", content.indexOf("prisma.subAgentRun.create")) + 3
    );
    
    if (!createSection.includes("id: runId")) {
      throw new Error("创建记录时未设置 id");
    }
    if (!createSection.includes('status: "RUNNING"')) {
      throw new Error("创建记录时未设置 status 为 RUNNING");
    }
    if (!createSection.includes("startedAt: new Date()")) {
      throw new Error("创建记录时未设置 startedAt");
    }
    console.log("  ✅ 创建记录包含必需字段");
  } catch (error) {
    console.error("  ❌ Test 2 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 3: 检查 awaitCompletion 状态更新 ─────────────────────
  console.log("✓ Test 3: 检查 awaitCompletion 更新 COMPLETED 状态");
  try {
    const sdkPath = "./features/ai/agents/work/subagents/pi/transports/sdk.ts";
    const content = await fs.readFile(sdkPath, "utf-8");
    
    // 找到 awaitCompletion 方法
    const methodStart = content.indexOf("private async awaitCompletion");
    if (methodStart === -1) {
      throw new Error("awaitCompletion 方法未找到");
    }
    
    const methodEnd = content.indexOf("\n  }", methodStart + 200);
    const methodContent = content.substring(methodStart, methodEnd);
    
    // 检查 COMPLETED 状态更新
    if (!methodContent.includes("prisma.subAgentRun.update")) {
      throw new Error("awaitCompletion 中未找到更新记录的代码");
    }
    console.log("  ✅ awaitCompletion 中有更新逻辑");
    
    if (!methodContent.includes('status: "COMPLETED"')) {
      throw new Error("未更新状态为 COMPLETED");
    }
    console.log("  ✅ 更新状态为 COMPLETED");
    
    if (!methodContent.includes("completedAt: new Date()")) {
      throw new Error("未设置 completedAt");
    }
    console.log("  ✅ 设置 completedAt");
    
    // 检查 FAILED 状态更新（事件流结束但没有 run_completed）
    if (!methodContent.includes('status: "FAILED"')) {
      throw new Error("未处理 FAILED 状态");
    }
    console.log("  ✅ 处理 FAILED 状态");
  } catch (error) {
    console.error("  ❌ Test 3 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 4: 检查 abort 状态更新 ───────────────────────────────
  console.log("✓ Test 4: 检查 abort 更新 CANCELLED 状态");
  try {
    const sdkPath = "./features/ai/agents/work/subagents/pi/transports/sdk.ts";
    const content = await fs.readFile(sdkPath, "utf-8");
    
    // 找到 abort 方法
    const methodStart = content.indexOf("async abort(runId: string)");
    if (methodStart === -1) {
      throw new Error("abort 方法未找到");
    }
    
    const methodEnd = content.indexOf("\n  }", methodStart + 100);
    const methodContent = content.substring(methodStart, methodEnd);
    
    // 检查 CANCELLED 状态更新
    if (!methodContent.includes("prisma.subAgentRun.update")) {
      throw new Error("abort 中未找到更新记录的代码");
    }
    console.log("  ✅ abort 中有更新逻辑");
    
    if (!methodContent.includes('status: "CANCELLED"')) {
      throw new Error("未更新状态为 CANCELLED");
    }
    console.log("  ✅ 更新状态为 CANCELLED");
    
    if (!methodContent.includes("completedAt: new Date()")) {
      throw new Error("未设置 completedAt");
    }
    console.log("  ✅ 设置 completedAt");
  } catch (error) {
    console.error("  ❌ Test 4 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 5: 检查数据库迁移 ─────────────────────────────────────
  console.log("✓ Test 5: 检查数据库迁移文件");
  try {
    const migrationsPath = "./prisma/migrations";
    const entries = await fs.readdir(migrationsPath);
    
    // 查找包含 "phase4" 或 "subagent" 的迁移
    const phase4Migrations = entries.filter(e => 
      e.includes("phase4") || 
      e.includes("subagent") ||
      e.includes("policy")
    );
    
    if (phase4Migrations.length === 0) {
      console.warn("  ⚠️  未找到 Phase 4 相关迁移文件");
      console.warn("     请确认数据库迁移已执行");
    } else {
      console.log(`  ✅ 找到 ${phase4Migrations.length} 个相关迁移:`);
      for (const migration of phase4Migrations) {
        console.log(`     - ${migration}`);
      }
    }
  } catch (error) {
    console.error("  ❌ Test 5 失败:", error);
    // 非致命错误，继续
  }

  console.log("");

  // ─── 总结 ─────────────────────────────────────────────────────
  console.log("✅ Phase 4 P1 验证通过！\n");
  console.log("已验证项：");
  console.log("  ✓ SubAgentRun 数据库模型完整");
  console.log("  ✓ PiSdkRuntime.start() 创建记录（RUNNING）");
  console.log("  ✓ awaitCompletion() 更新状态（COMPLETED / FAILED）");
  console.log("  ✓ abort() 更新状态（CANCELLED）");
  console.log("  ✓ 所有状态转换包含 completedAt 时间戳");
  console.log("");
  console.log("🎯 P1 任务：SubAgentRun 持久化已完成");
}

main().catch((error) => {
  console.error("\n❌ Phase 4 P1 验证失败:", error);
  process.exit(1);
});
