// Test 2: Event Stream (subscribe test)
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

console.log('=== Test 2: Event Stream ===\n');

try {
  const modelRuntime = await ModelRuntime.create({
    agentDir: '.pi-agent',
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const result = await createAgentSession({
    cwd: process.cwd(),
    agentDir: '.pi-agent',
    modelRuntime,
    noTools: 'all',
  });

  const { session } = result;

  // Test event subscription
  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event.type);
    console.log('📡 Event:', event.type);
  });

  console.log('✅ subscribe() works, unsubscribe:', typeof unsubscribe === 'function');

  // Trigger some events (isIdle check, etc)
  console.log('Session isIdle:', session.isIdle);
  console.log('Session isStreaming:', session.isStreaming);

  unsubscribe();
  console.log('✅ Event stream test passed');

  session.dispose();

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
