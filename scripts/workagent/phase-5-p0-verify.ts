/**
 * Phase 5 P0 验证脚本
 * 
 * 验证内容：
 * 1. 用户 API Key 凭证读取（从数据库）
 * 2. Pi SDK session 创建（真实 SDK）
 * 3. 简单任务执行（"读取 package.json"）
 * 4. 事件流接收和翻译
 * 5. Session 正常完成
 * 
 * 使用方法：
 * ```bash
 * npx tsx scripts/phase-5-p0-verify.ts <userId>
 * ```
 */

import { PiSdkRuntime } from "../../features/ai/agents/work/subagents/pi/transports/sdk";
import type { PiRunInput } from "../../features/ai/agents/work/subagents/pi/runtime";

async function main() {
  const userId = process.argv[2];
  
  if (!userId) {
    console.error("❌ Usage: npx tsx scripts/phase-5-p0-verify.ts <userId>");
    process.exit(1);
  }
  
  console.log("=== Phase 5 P0 端到端验证 ===\n");
  console.log(`User ID: ${userId}`);
  console.log(`Workspace: ${process.cwd()}\n`);
  
  // 1. 创建 Pi SDK Runtime
  console.log("📦 Step 1: 创建 PiSdkRuntime...");
  const runtime = new PiSdkRuntime({
    agentDir: ".pi-agent",
  });
  console.log("✅ PiSdkRuntime 创建成功\n");
  
  // 2. 启动 run
  console.log("🚀 Step 2: 启动 Pi session...");
  const input: PiRunInput = {
    userId,
    workspace: process.cwd(),
    prompt: "读取 package.json 文件，告诉我这个项目的名称和版本号",
    contextFiles: [],
    provider: "deepseek", // 使用用户配置的 DeepSeek key
  };
  
  let handle;
  try {
    handle = await runtime.start(input);
    console.log(`✅ Pi session 启动成功`);
    console.log(`   - runId: ${handle.runId}`);
    console.log(`   - sessionId: ${handle.sessionId}\n`);
  } catch (error) {
    console.error("❌ Step 2 失败:", error);
    process.exit(1);
  }
  
  // 3. 监听事件流
  console.log("📡 Step 3: 监听事件流...\n");
  let eventCount = 0;
  const eventTypes = new Set<string>();
  
  try {
    for await (const event of handle.events) {
      eventCount++;
      eventTypes.add(event.type);
      
      console.log(`[Event ${eventCount}] ${event.type}`);
      
      switch (event.type) {
        case "run_started":
          console.log(`   → Session started: ${event.sessionId}`);
          break;
        
        case "assistant_message":
          console.log(`   → Message: ${event.content.substring(0, 100)}${event.content.length > 100 ? "..." : ""}`);
          break;
        
        case "tool_call":
          console.log(`   → Tool: ${event.tool}`);
          console.log(`   → Args:`, JSON.stringify(event.args, null, 2).substring(0, 200));
          break;
        
        case "tool_result":
          console.log(`   → Success: ${event.success}`);
          console.log(`   → Result: ${typeof event.result === "string" ? event.result.substring(0, 100) : JSON.stringify(event.result).substring(0, 100)}`);
          break;
        
        case "tool_error":
          console.log(`   → Error: ${event.error}`);
          break;
        
        case "approval_required":
          console.log(`   → Tool: ${event.tool}`);
          console.log(`   → Reason: ${event.reason}`);
          break;
        
        case "progress":
          console.log(`   → Message: ${event.message}`);
          console.log(`   → Percent: ${event.percent}%`);
          break;
        
        case "error":
          console.log(`   → Error: ${event.message}`);
          break;
        
        case "run_completed":
          console.log(`   → Status: ${event.result.status}`);
          console.log(`   → Summary: ${event.result.summary}`);
          console.log(`   → Duration: ${event.result.durationMs}ms`);
          break;
      }
      
      console.log("");
    }
  } catch (error) {
    console.error("❌ Step 3 事件流异常:", error);
    process.exit(1);
  }
  
  // 4. 等待完成
  console.log("⏳ Step 4: 等待任务完成...\n");
  let result;
  try {
    result = await handle.awaitCompletion();
    console.log("✅ 任务完成");
    console.log(`   - Status: ${result.status}`);
    console.log(`   - Duration: ${result.durationMs}ms`);
    console.log(`   - Summary: ${result.summary || "N/A"}`);
    
    if (result.error) {
      console.log(`   - Error: ${result.error}`);
    }
    
    if (Object.keys(result.artifacts).length > 0) {
      console.log(`   - Artifacts:`, result.artifacts);
    }
  } catch (error) {
    console.error("❌ Step 4 失败:", error);
    process.exit(1);
  }
  
  // 5. 验证结果
  console.log("\n📊 验证统计:");
  console.log(`   - 接收事件数: ${eventCount}`);
  console.log(`   - 事件类型数: ${eventTypes.size}`);
  console.log(`   - 事件类型: ${Array.from(eventTypes).join(", ")}`);
  
  // 检查必要事件
  const requiredEvents = ["run_started", "run_completed"];
  const missingEvents = requiredEvents.filter(e => !eventTypes.has(e));
  
  if (missingEvents.length > 0) {
    console.log(`\n⚠️  缺少必要事件: ${missingEvents.join(", ")}`);
  }
  
  // 检查任务状态
  if (result.status === "completed") {
    console.log("\n✅ Phase 5 P0 验证通过！");
    process.exit(0);
  } else if (result.status === "failed") {
    console.log(`\n❌ 任务失败: ${result.error}`);
    process.exit(1);
  } else {
    console.log(`\n⚠️  任务状态异常: ${result.status}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ 脚本执行失败:", error);
  process.exit(1);
});
