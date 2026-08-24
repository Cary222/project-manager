/**
 * Sandbox Runtime Provider Interface
 * Provides runtime capabilities to sandboxed iframes
 */

export interface SandboxRuntimeProvider {
  /**
   * Returns data to inject into window scope.
   * Keys become window properties
   */
  getData(): Record<string, unknown>;

  /**
   * Returns a runtime function executed in the sandbox.
   */
  getRuntime(): (sandboxId: string) => void;

  /**
   * Optional message handler for bidirectional communication
   */
  handleMessage?(message: unknown, respond: (response: unknown) => void): Promise<void>;

  /**
   * Documentation describing globals/functions this provider injects
   */
  getDescription(): string;

  /**
   * Called when sandbox execution starts
   */
  onExecutionStart?(sandboxId: string, signal?: AbortSignal): void;

  /**
   * Called when sandbox execution ends
   */
  onExecutionEnd?(sandboxId: string): void;
}
