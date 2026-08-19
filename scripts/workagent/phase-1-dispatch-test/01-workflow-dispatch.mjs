/**
 * Phase 1 Test 1: Workflow Dispatch
 * 验证 dispatchNode 能正确识别并路由到 workflow
 */

import { getWorkAgentGraph } from '../../features/ai/agents/work/graph.ts';

console.log('=== Test 1: Workflow Dispatch ===\n');

try {
  const graph = getWorkAgentGraph();
  
  // Test case 1: 周报任务
  console.log('Test Case 1: 周报任务');
  const result1 = await graph.invoke({
    userInput: '帮我生成本周的周报',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  
  console.log('Result:', {
    taskType: result1.taskType,
    workflowType: result1.workflowType,
    workflowName: result1.workflowName,
    status: result1.status,
  });
  
  if (result1.taskType === 'workflow' && result1.workflowType === 'weekly-report') {
    console.log('✅ Workflow dispatch successful\n');
  } else {
    console.log('❌ Expected workflow task, got:', result1.taskType, '\n');
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
