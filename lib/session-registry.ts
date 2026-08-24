/**
 * Shared session registry — lives in a separate module so both rpc-manager.ts
 * and pi-types.ts can access it without creating a circular dependency.
 */

import type { AgentSessionWrapper } from "./rpc-manager";

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piRunningListeners: Set<(ids: string[]) => void> | undefined;
}

export function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
  }
  return globalThis.__piSessions;
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}
