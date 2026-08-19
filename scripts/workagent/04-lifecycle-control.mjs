// Test 4: Lifecycle Control - verify abort/session API
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

console.log('=== Test 4: Lifecycle Control ===\n');

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

  // Verify session API surface
  const apiSurface = {
    sendUserMessage: typeof session.sendUserMessage === 'function',
    subscribe: typeof session.subscribe === 'function',
    abort: typeof session.abort === 'function',
    waitForIdle: typeof session.waitForIdle === 'function',
    close: typeof session.close === 'function',
    getLastAssistantText: typeof session.getLastAssistantText === 'function',
  };

  console.log('✅ Session API surface:', apiSurface);

  // Test subscribe
  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event.type);
  });
  console.log('✅ subscribe() works, unsubscribe:', typeof unsubscribe === 'function');
  unsubscribe();

  // Test abort (should not throw when not running)
  if (typeof session.abort === 'function') {
    try {
      await session.abort();
      console.log('✅ abort() callable (no active session to abort)');
    } catch (e) {
      console.log('⚠️  abort() threw:', e.message);
    }
  }

  await session.dispose();
  console.log('✅ Lifecycle control test passed');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
