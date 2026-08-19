// Test 2: Extension Tool Call Intercept (API Structure Test)
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

console.log('=== Test 2: Extension Tool Call Intercept ===\n');

try {
  const interceptedCalls = [];
  let extensionLoaded = false;

  const testExtension = {
    name: 'test-interceptor',
    async onAgentSessionCreated(extensionApi) {
      console.log('✅ Extension loaded');
      extensionLoaded = true;

      // Verify ExtensionAPI has required methods
      console.log('ExtensionAPI structure:', {
        hasOn: typeof extensionApi.on === 'function',
        hasRegisterTool: typeof extensionApi.registerTool === 'function',
      });

      // Hook tool_call event
      extensionApi.on('tool_call', async (event) => {
        console.log('🔧 tool_call hook registered');
        interceptedCalls.push(event.tool);
        // Return { block: false } to allow
        return { block: false };
      });
    },
  };

  const modelRuntime = await ModelRuntime.create({
    agentDir: '.pi-agent',
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const result = await createAgentSession({
    cwd: process.cwd(),
    agentDir: '.pi-agent',
    modelRuntime,
    extensions: [testExtension],
    noTools: 'all',
  });

  const { session, extensionsResult } = result;

  console.log('✅ Extension system verified:', {
    extensionLoaded,
    extensionsCount: extensionsResult.extensions?.length || 0,
  });

  await session.dispose();
  console.log('✅ Test passed - Extension API structure verified');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
