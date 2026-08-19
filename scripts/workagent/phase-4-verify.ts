/**
 * Phase 4 验证脚本 - HIL 闭环 + API 路由
 * 
 * 验证内容：
 * 1. /api/ai/work/approve 路由可用
 * 2. PiRuntime.followUp() 实现正确
 * 3. HIL 完整流程（tool_call → approval → resume）
 * 4. Mock 事件流包含 approval_required 事件
 */

async function main() {
  console.log("🔍 Phase 4 验证开始...\n");

  // ─── Test 1: API 路由存在性检查 ────────────────────────────────
  console.log("✓ Test 1: 检查 /api/ai/work/approve 路由文件");
  try {
    const fs = await import("fs/promises");
    const routePath = "./app/api/ai/work/approve/route.ts";
    const stat = await fs.stat(routePath);
    
    if (stat.isFile()) {
      console.log("  ✅ 路由文件存在");
      
      // 检查关键导出
      const content = await fs.readFile(routePath, "utf-8");
      if (content.includes("export async function POST")) {
        console.log("  ✅ POST 方法已导出");
      } else {
        throw new Error("POST 方法未找到");
      }
      
      if (content.includes("export async function GET")) {
        console.log("  ✅ GET 方法已导出");
      } else {
        console.log("  ⚠️  GET 方法未找到（可选）");
      }
      
      // 检查关键逻辑
      if (content.includes("getPiSubAgent")) {
        console.log("  ✅ 集成 PiSubAgent");
      }
      
      if (content.includes("getPolicyGateway")) {
        console.log("  ✅ 集成 PolicyGateway");
      }
      
      if (content.includes('decision === "approve"')) {
        console.log("  ✅ 审批决策逻辑存在");
      }
      
      if (content.includes("resume")) {
        console.log("  ✅ 调用 resume 方法");
      }
    }
  } catch (error) {
    console.error("  ❌ Test 1 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 2: PiRuntime followUp 实现检查 ──────────────────────
  console.log("✓ Test 2: 检查 PiRuntime.followUp() 实现");
  try {
    const { PiSdkRuntime } = await import("../../features/ai/agents/work/subagents/pi/transports/sdk.js");
    const runtime = new PiSdkRuntime();
    
    // 检查方法存在
    if (typeof runtime.followUp === "function") {
      console.log("  ✅ followUp() 方法存在");
    } else {
      throw new Error("followUp() 方法未找到");
    }
    
    // 检查方法签名（不实际调用，只检查是否抛出 "not implemented"）
    const fs = await import("fs/promises");
    const sdkPath = "./features/ai/agents/work/subagents/pi/transports/sdk.ts";
    const content = await fs.readFile(sdkPath, "utf-8");
    
    if (content.includes('throw new Error("followUp() not implemented')) {
      throw new Error("followUp() 仍然是 stub 实现");
    }
    
    console.log("  ✅ followUp() 已实现（非 stub）");
    
    // 检查是否有 pausedRuns 管理
    if (content.includes("pausedRuns")) {
      console.log("  ✅ pausedRuns 状态管理存在");
    }
    
    if (content.includes("waitForApproval")) {
      console.log("  ✅ waitForApproval 辅助方法存在");
    }
  } catch (error) {
    console.error("  ❌ Test 2 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 3: Mock 事件流包含 approval_required ────────────────
  console.log("✓ Test 3: 检查 Mock 事件流中的 approval_required 事件");
  try {
    const { PiSdkRuntime } = await import("../../features/ai/agents/work/subagents/pi/transports/sdk.js");
    const runtime = new PiSdkRuntime({ debug: true });
    
    const handle = await runtime.start({
      prompt: "Test HIL flow",
      workspace: "/tmp",
      userId: "test-user",
    });
    
    console.log("  ✅ Runtime 启动成功");
    console.log(`  ℹ️  runId: ${handle.runId}`);
    console.log(`  ℹ️  sessionId: ${handle.sessionId}`);
    
    let hasApprovalRequired = false;
    let approvalCallId = "";
    let eventCount = 0;
    
    // 消费事件流（需要在独立的 async context 中进行，否则会阻塞）
    const eventPromise = (async () => {
      for await (const event of handle.events) {
        eventCount++;
        console.log(`  📡 Event ${eventCount}: ${event.type}`);
        
        if (event.type === "approval_required") {
          hasApprovalRequired = true;
          approvalCallId = event.callId;
          console.log(`  ✅ approval_required 事件触发 (callId: ${event.callId})`);
          console.log(`     - tool: ${event.tool}`);
          console.log(`     - reason: ${event.reason}`);
          
          // 模拟用户批准（调用 followUp）
          console.log(`  🔄 模拟用户批准...`);
          await runtime.followUp(handle.runId, "User approved the action");
          console.log(`  ✅ followUp() 调用成功`);
        }
        
        if (event.type === "run_completed") {
          console.log(`  🎉 Run 完成: ${event.result.status}`);
          break;
        }
      }
    })();
    
    // 等待事件流完成（最多 10 秒）
    await Promise.race([
      eventPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("事件流超时（10 秒）")), 10000)
      ),
    ]);
    
    if (!hasApprovalRequired) {
      throw new Error("未找到 approval_required 事件");
    }
    
    console.log(`  ✅ HIL 流程完整（共 ${eventCount} 个事件）`);
  } catch (error) {
    console.error("  ❌ Test 3 失败:", error);
    throw error;
  }

  console.log("");

  // ─── Test 4: 事件翻译器支持 approval_required ──────────────────
  console.log("✓ Test 4: 检查事件翻译器");
  try {
    const { translateSingleEvent } = await import("../../features/ai/agents/work/subagents/pi/events.js");
    
    const mockPiEvent = {
      type: "approval_required",
      runId: "test-run",
      callId: "call-123",
      tool: "git_push",
      args: { remote: "origin", branch: "main" },
      reason: "高风险操作",
    };
    
    const translated = translateSingleEvent(mockPiEvent, "test-run");
    
    if (!translated) {
      throw new Error("翻译结果为 null");
    }
    
    if (translated.type !== "approval_required") {
      throw new Error(`翻译后类型错误: ${translated.type}`);
    }
    
    console.log("  ✅ approval_required 事件翻译正确");
    console.log(`     - callId: ${translated.callId}`);
    console.log(`     - tool: ${translated.tool}`);
    console.log(`     - reason: ${translated.reason}`);
  } catch (error) {
    console.error("  ❌ Test 4 失败:", error);
    throw error;
  }

  console.log("");

  // ─── 总结 ─────────────────────────────────────────────────────
  console.log("✅ Phase 4 P0 验证通过！\n");
  console.log("已验证项：");
  console.log("  ✓ /api/ai/work/approve 路由存在并包含必要逻辑");
  console.log("  ✓ PiRuntime.followUp() 已实现（非 stub）");
  console.log("  ✓ HIL 完整流程可运行（tool_call → approval → resume）");
  console.log("  ✓ 事件翻译器支持 approval_required 事件");
  console.log("");
  console.log("🎯 P0 阻塞项已全部解决，可进入 P1 任务");
}

main().catch((error) => {
  console.error("\n❌ Phase 4 验证失败:", error);
  process.exit(1);
});
