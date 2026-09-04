import "server-only";

import { randomUUID } from "node:crypto";
import { createPiSessionOwnership } from "./pi-session-ownership";

export interface PiRuntimePort {
  start(input: {
    cwd: string;
    prompt: string;
  }): Promise<{ sessionId: string; shutdown(): Promise<void> }>;
}

/** Work's only coding-runtime entry point. The HTTP/RPC implementation is injected later. */
export class PiCodingAdapter {
  constructor(private readonly runtime: PiRuntimePort) {}

  async start(input: {
    userId: string;
    cwd: string;
    prompt: string;
    projectId?: string;
    ticketId?: string;
  }) {
    const runtime = await this.runtime.start({
      cwd: input.cwd,
      prompt: input.prompt,
    });
    try {
      await createPiSessionOwnership({
        piSessionId: runtime.sessionId,
        userId: input.userId,
        source: "work_coding",
        projectId: input.projectId,
        ticketId: input.ticketId,
      });
      return { runId: `work-pi-${randomUUID()}`, sessionId: runtime.sessionId };
    } catch (error) {
      await runtime.shutdown().catch(() => undefined);
      throw error;
    }
  }
}
