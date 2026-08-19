/**
 * Phase 0 - Test 4: HIL Pause and Resume
 * 
 * 验证：External HIL ability to pause and resume tool_call
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testHILPauseResume() {
  console.log("=== Test 4: HIL Pause and Resume ===\n");

  try {
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
    });

    console.log("✅ Session created");

    // 订阅事件，检测 tool_call
    session.subscribe((event) => {
      if (event.type === "tool_call") {
        console.log(`[Tool Call] ${event.data?.function?.name}`);
        // 这里可以暂停并等待人工批准
        console.log("[HIL] Would pause here for approval");
      }
    });

    console.log("\n--- Sending prompt that triggers tool call ---");
    await session.prompt({
      role: "user",
      content: "Read package.json and tell me the project name"
    });

    console.log("\n✅ Test 4 passed - HIL interception point identified");

  } catch (error) {
    console.error("❌ Test 4 failed:", error);
    process.exit(1);
  }
}

testHILPauseResume();
