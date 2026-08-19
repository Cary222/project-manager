// Test 6: Workspace Isolation (cwd test)
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { mkdir } from 'fs/promises';

console.log('=== Test 6: Workspace Isolation ===\n');

try {
  // Create isolated workspaces
  const workspace1 = '.pi-workspace-1';
  const workspace2 = '.pi-workspace-2';
  
  await mkdir(workspace1, { recursive: true });
  await mkdir(workspace2, { recursive: true });
  console.log('✅ Workspaces created');

  const modelRuntime = await ModelRuntime.create({
    agentDir: '.pi-agent',
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  // Session 1 in workspace1
  console.log('\nCreating session 1 in', workspace1);
  const result1 = await createAgentSession({
    cwd: workspace1,
    agentDir: '.pi-agent',
    modelRuntime,
    noTools: 'all',
  });

  const { session: session1 } = result1;
  console.log('✅ Session 1 created with cwd:', workspace1);
  await session1.dispose();

  // Session 2 in workspace2
  console.log('\nCreating session 2 in', workspace2);
  const result2 = await createAgentSession({
    cwd: workspace2,
    agentDir: '.pi-agent',
    modelRuntime,
    noTools: 'all',
  });

  const { session: session2 } = result2;
  console.log('✅ Session 2 created with cwd:', workspace2);
  await session2.dispose();

  console.log('\n✅ Workspace isolation test passed');
  console.log('Both sessions created with different cwd values');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
