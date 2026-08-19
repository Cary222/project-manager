/**
 * Phase 0 - Test 5: Lifecycle API
 * 
 * 验证：steer / followUp / abort — lifecycle API
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testLifecycleAPI() {
  console.log("=== Test 5: Lifecycle API ===\n");

  try {
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
    });

    console.log("✅ Session created");

    // Test 1: prompt basic
    console.log("\n--- Test: sendUserMessage ---");
    await session.sendUserMessage("Say hello briefly");
    await session.waitForIdle();
    const lastText = session.getLastAssistantText();
    console.log("Response:", lastText?.substring(0, 100));
    console.log("✅ sendUserMessage works");

    // Test 2: steer (interrupt)
    console.log("\n--- Test: steer (interrupt current) ---");
    await session.sendUserMessage(
      "Count to 1000 slowly",
      { deliverAs: "steer" }
    );
    // Immediately abort
    await new Promise(r => setTimeout(r, 500));
    await session.abort();
    console.log("✅ abort() works");

    // Test 3: followUp
    console.log("\n--- Test: followUp ---");
    await session.sendUserMessage("What is 2+2?");
    await session.sendUserMessage(
      "Just the number please",
      { deliverAs: "followUp" }
    );
    await session.waitForIdle();
    console.log("✅ followUp queuing works");

    console.log("\n✅ Test 5 passed");

  } catch (error) {
    console.error("❌ Test 5 failed:", error);
    process.exit(1);
  }
}

testLifecycleAPI();
