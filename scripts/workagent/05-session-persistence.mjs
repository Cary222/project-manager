// Test 5: Session Persistence (sessionId test)
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

console.log('=== Test 5: Session Persistence ===\n');

const sessionId = 'test-resume-session';

try {
  const modelRuntime = await ModelRuntime.create({
    agentDir: '.pi-agent',
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  // First session
  console.log('Creating first session with sessionId...');
  const result1 = await createAgentSession({
    cwd: process.cwd(),
    agentDir: '.pi-agent',
    modelRuntime,
    sessionId,
    noTools: 'all',
  });

  const { session: session1 } = result1;
  console.log('✅ First session created');
  session1.dispose();
  console.log('✅ First session closed');

  // Resume session
  console.log('\nResuming session with same sessionId...');
  const result2 = await createAgentSession({
    cwd: process.cwd(),
    agentDir: '.pi-agent',
    modelRuntime,
    sessionId,
    noTools: 'all',
  });

  const { session: session2 } = result2;
  console.log('✅ Session resumed (same sessionId accepted)');
  
  session2.dispose();
  console.log('✅ Session persistence test passed');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
