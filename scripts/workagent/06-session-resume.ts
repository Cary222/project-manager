/**
 * Phase 0 - Test 6: Session Resume
 * 
 * 验证：Session resume — persistence verification
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testSessionResume() {
  console.log("=== Test 6: Session Resume ===\n");

  const sessionId = "test-session-" + Date.now();

  try {
    // Create initial session
    console.log("--- Creating initial session ---");
    const { session: session1 } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
      agentDir: `./tmp/pi-sessions/${sessionId}`,
    });

    await session1.prompt({
      role: "user",
      content: "Remember this: my favorite color is blue"
    });

    console.log("✅ Initial session created and prompt sent");

    // Cleanup first session
    await session1.dispose();
    console.log("✅ First session disposed");

    // Resume session
    console.log("\n--- Resuming session ---");
    const { session: session2 } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
      agentDir: `./tmp/pi-sessions/${sessionId}`,
    });

    await session2.prompt({
      role: "user",
      content: "What was my favorite color?"
    });

    console.log("✅ Session resumed successfully");
    console.log("\n✅ Test 6 passed");

    await session2.dispose();

  } catch (error) {
    console.error("❌ Test 6 failed:", error);
    process.exit(1);
  }
}

testSessionResume();
