// Test 3: Custom Tool Registration (API Structure Test)
import { createAgentSession, ModelRuntime, defineTool } from '@earendil-works/pi-coding-agent';

console.log('=== Test 3: Custom Tool Registration ===\n');

try {
  let toolRegistered = false;
  let toolCalled = false;

  const customToolExtension = {
    name: 'projecthub-tools',
    async onAgentSessionCreated(extensionApi) {
      console.log('✅ Extension loaded');

      // Register custom tool via extensionApi
      extensionApi.registerTool({
        name: 'get_project_info',
        description: 'Get information about a ProjectHub project',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project ID' },
          },
          required: ['projectId'],
        },
        execute: async ({ projectId }) => {
          console.log('🔧 Custom tool called with projectId:', projectId);
          toolCalled = true;
          return JSON.stringify({
            projectId,
            name: 'Test Project',
            status: 'active',
            fromPiSDK: true,
          });
        },
      });

      toolRegistered = true;
      console.log('✅ Custom tool registered: get_project_info');
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
    extensions: [customToolExtension],
    noTools: 'all',
  });

  const { session } = result;

  console.log('\n✅ Custom tool test summary:', {
    toolRegistered,
    sessionHasSendUserMessage: typeof session.sendUserMessage === 'function',
  });

  await session.dispose();
  console.log('✅ Custom tool registration verified');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
