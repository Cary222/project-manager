/**
 * Phase 0 - Test 1: Basic Session Creation
 * 
 * 验证：createAgentSession() SDK 初始化
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testBasicSession() {
  console.log("=== Test 1: Basic Session Creation ===\n");

  try {
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],  // 只启用 read 工具做基础测试
    });

    console.log("✅ Session created successfully");
    console.log("Session ID:", session.id);
    
    // 测试简单 prompt
    console.log("\n--- Testing simple prompt ---");
    const result = await session.prompt({
      role: "user",
      content: "Read the package.json file and tell me the project name"
    });

    console.log("Response:", result.text?.substring(0, 200));
    console.log("\n✅ Test 1 passed");

  } catch (error) {
    console.error("❌ Test 1 failed:", error);
    process.exit(1);
  }
}

testBasicSession();
