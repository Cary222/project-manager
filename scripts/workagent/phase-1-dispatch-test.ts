/**
 * Phase 1 Dispatch Logic Test
 * 验证 Work Agent 的 dispatch 路由逻辑
 */

import { getWorkAgentGraph } from "../../features/ai/agents/work/graph";

async function testDispatch() {
  console.log("=== Phase 1: Dispatch Logic Test ===\n");

  const graph = getWorkAgentGraph();

  // Test Case 1: Workflow Task (Weekly Report)
  console.log("Test 1: 识别周报任务");
  try {
    const result1 = await graph.invoke({
      userInput: "帮我生成本周的周报",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log("✅ Result:", {
      taskType: result1.taskType,
      workflowType: result1.workflowType,
      status: result1.status,
    });
  } catch (err) {
    console.error("❌ Error:", err);
  }

  console.log("\nTest 2: 识别编程任务");
  try {
    const result2 = await graph.invoke({
      userInput: "帮我写一个 React 组件",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log("✅ Result:", {
      taskType: result2.taskType,
      status: result2.status,
      summary: result2.summary,
    });
  } catch (err) {
    console.error("❌ Error:", err);
  }

  console.log("\nTest 3: 无法识别的任务");
  try {
    const result3 = await graph.invoke({
      userInput: "今天天气怎么样",
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log("✅ Result:", {
      taskType: result3.taskType,
      status: result3.status,
      error: result3.error,
    });
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

testDispatch().catch(console.error);
