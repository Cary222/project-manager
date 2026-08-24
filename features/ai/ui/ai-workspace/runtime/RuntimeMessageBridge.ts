/**
 * Runtime Message Bridge
 * Generates sendRuntimeMessage() function for injection into sandboxed iframes
 */

export interface RuntimeMessageBridgeOptions {
  context: "sandbox-iframe" | "user-script";
  sandboxId: string;
}

export function generateBridgeCode(options: RuntimeMessageBridgeOptions): string {
  if (options.context === "sandbox-iframe") {
    return generateSandboxBridge(options.sandboxId);
  } else {
    return generateUserScriptBridge(options.sandboxId);
  }
}

function generateSandboxBridge(sandboxId: string): string {
  return `
window.__completionCallbacks = [];
window.sendRuntimeMessage = async (message) => {
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    return new Promise((resolve, reject) => {
        const handler = (e) => {
            if (e.data.type === 'runtime-response' && e.data.messageId === messageId) {
                window.removeEventListener('message', handler);
                if (e.data.success) {
                    resolve(e.data);
                } else {
                    reject(new Error(e.data.error || 'Operation failed'));
                }
            }
        };

        window.addEventListener('message', handler);

        window.parent.postMessage({
            ...message,
            sandboxId: ${JSON.stringify(sandboxId)},
            messageId: messageId
        }, '*');

        setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('Runtime message timeout'));
        }, 30000);
    });
};
window.onCompleted = (callback) => {
    window.__completionCallbacks.push(callback);
};
`.trim();
}

function generateUserScriptBridge(sandboxId: string): string {
  return `
window.__completionCallbacks = [];
window.sendRuntimeMessage = async (message) => {
    return await chrome.runtime.sendMessage({
        ...message,
        sandboxId: ${JSON.stringify(sandboxId)}
    });
};
window.onCompleted = (callback) => {
    window.__completionCallbacks.push(callback);
};
`.trim();
}
