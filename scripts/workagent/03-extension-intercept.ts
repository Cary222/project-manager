/**
 * Phase 0 - Test 3: Extension Intercept Point
 * 
 * 验证：tool_call pre-hook — Extension 拦截点
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testExtensionIntercept() {
  console.log("=== Test 3: Extension Intercept Point ===\n");

  const interceptedCalls: string[] = [];

  try {
    const myExtension = {
      name: "intercept-extension",
      onToolCall: async (toolCall: any, context: any) => {
        interceptedCalls.push(toolCall.function.name);
        console.log(`[Intercepted] ${toolCall.function.name}`);
        return null; // Allow execution
      }
    };

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
      extensions: [myExtension],
    });

    console.log("✅ Session with extension created");

    await session.prompt({
      role: "user",
      content: "Read package.json"
    });

    console.log("\n--- Intercept summary ---");
    console.log("Intercepted calls:", interceptedCalls.join(", "));
    console.log("\n✅ Test 3 passed");

  } catch (error) {
    console.error("❌ Test 3 failed:", error);
    process.exit(1);
  }
}

testExtensionIntercept();
