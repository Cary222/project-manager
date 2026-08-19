// Test 1: Basic Session Creation (No LLM call)
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

console.log('=== Test 1: Basic Session Creation ===\n');

try {
  // Create ModelRuntime first
  console.log('Creating ModelRuntime...');
  const modelRuntime = await ModelRuntime.create({
    agentDir: '.pi-agent',
    allowModelNetwork: false,  // Don't fetch models
    refreshOnCreate: false,    // Don't refresh on create
  });
  
  console.log('✅ ModelRuntime created');

  // Create session
  console.log('Creating AgentSession...');
  const result = await createAgentSession({
    cwd: process.cwd(),
    agentDir: '.pi-agent',
    modelRuntime,
    noTools: 'all',  // Disable all tools for this test
  });

  const { session } = result;
  console.log('✅ Session created:', {
    hasSession: !!session,
    hasSendUserMessage: typeof session.sendUserMessage === 'function',
    hasSubscribe: typeof session.subscribe === 'function',
    hasAbort: typeof session.abort === 'function',
    hasClose: typeof session.close === 'function',
  });

  await session.dispose();
  console.log('✅ Session closed successfully');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
