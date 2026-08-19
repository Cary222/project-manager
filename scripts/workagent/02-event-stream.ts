/**
 * Phase 0 - Test 2: Event Stream Verification
 * 
 * 验证：prompt() + subscribe() — 事件流验证
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testEventStream() {
  console.log("=== Test 2: Event Stream Verification ===\n");

  try {
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
    });

    console.log("✅ Session created");

    // 订阅事件流
    const events: string[] = [];
    session.subscribe((event) => {
      events.push(event.type);
      console.log(`[Event] ${event.type}`);
    });

    console.log("\n--- Sending prompt ---");
    await session.prompt({
      role: "user",
      content: "List 3 files in current directory"
    });

    console.log("\n--- Event summary ---");
    console.log("Total events:", events.length);
    console.log("Event types:", [...new Set(events)].join(", "));
    console.log("\n✅ Test 2 passed");

  } catch (error) {
    console.error("❌ Test 2 failed:", error);
    process.exit(1);
  }
}

testEventStream();
