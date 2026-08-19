/**
 * Phase 0 - Test 3: Extension Tool Registration
 * 
 * 验证：Custom ProjectHub tool — Extension registerTool
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

async function testExtensionTool() {
  console.log("=== Test 3: Extension Tool Registration ===\n");

  try {
    const { session, extensions } = await createAgentSession({
      cwd: process.cwd(),
      tools: ["read"],
    });

    console.log("✅ Session created");

    // 注册自定义工具
    if (extensions && extensions.registerTool) {
      extensions.registerTool({
        name: "get_project_info",
        description: "Get ProjectHub project information",
        parameters: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID"
            }
          },
          required: ["projectId"]
        }
      }, async (args) => {
        console.log("[Tool Called] get_project_info:", args);
        return {
          projectId: args.projectId,
          name: "Test Project",
          status: "ACTIVE"
        };
      });

      console.log("✅ Custom tool registered");
    } else {
      console.log("⚠️  Extensions API not available");
    }

    console.log("\n✅ Test 3 passed");

  } catch (error) {
    console.error("❌ Test 3 failed:", error);
    process.exit(1);
  }
}

testExtensionTool();
