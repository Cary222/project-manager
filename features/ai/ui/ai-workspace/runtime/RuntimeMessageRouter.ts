/**
 * Runtime Message Router
 * Centralized message routing for sandbox communication
 */

import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider";

export interface MessageConsumer {
  handleMessage(message: unknown): Promise<void>;
}

interface SandboxContext {
  sandboxId: string;
  iframe: HTMLIFrameElement | null;
  providers: SandboxRuntimeProvider[];
  consumers: Set<MessageConsumer>;
}

export class RuntimeMessageRouter {
  private sandboxes = new Map<string, SandboxContext>();
  private messageListener: ((e: MessageEvent) => void) | null = null;

  registerSandbox(
    sandboxId: string,
    providers: SandboxRuntimeProvider[],
    consumers: MessageConsumer[]
  ): void {
    this.sandboxes.set(sandboxId, {
      sandboxId,
      iframe: null,
      providers,
      consumers: new Set(consumers),
    });

    this.setupListener();
  }

  setSandboxIframe(sandboxId: string, iframe: HTMLIFrameElement): void {
    const context = this.sandboxes.get(sandboxId);
    if (context) {
      context.iframe = iframe;
    }
  }

  unregisterSandbox(sandboxId: string): void {
    this.sandboxes.delete(sandboxId);

    if (this.sandboxes.size === 0 && this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
  }

  addConsumer(sandboxId: string, consumer: MessageConsumer): void {
    const context = this.sandboxes.get(sandboxId);
    if (context) {
      context.consumers.add(consumer);
    }
  }

  removeConsumer(sandboxId: string, consumer: MessageConsumer): void {
    const context = this.sandboxes.get(sandboxId);
    if (context) {
      context.consumers.delete(consumer);
    }
  }

  private setupListener(): void {
    if (this.messageListener) return;

    this.messageListener = async (e: MessageEvent) => {
      const data = e.data as { sandboxId?: string; messageId?: string };
      if (!data?.sandboxId) return;

      const context = this.sandboxes.get(data.sandboxId);
      if (!context) return;

      const respond = (response: unknown) => {
        context.iframe?.contentWindow?.postMessage(
          {
            type: "runtime-response",
            messageId: data.messageId,
            sandboxId: data.sandboxId,
            ...(response as object),
          },
          "*"
        );
      };

      // Provider handlers
      for (const provider of context.providers) {
        if (provider.handleMessage) {
          await provider.handleMessage(e.data, respond);
        }
      }

      // Consumer handlers
      for (const consumer of context.consumers) {
        await consumer.handleMessage(e.data);
      }
    };

    window.addEventListener("message", this.messageListener);
  }
}

export const RUNTIME_MESSAGE_ROUTER = new RuntimeMessageRouter();
