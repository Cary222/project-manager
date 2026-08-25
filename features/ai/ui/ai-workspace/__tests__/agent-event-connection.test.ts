import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentEventConnection, AgentEventConnectionError } from "../lib/agent-event-connection";

type FakeEventSource = {
  readyState: number;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
};

function fakeSource(): FakeEventSource {
  const close = vi.fn<() => void>();
  return { readyState: 1, onmessage: null, onerror: null, close };
}

function makeConnection() {
  const source = fakeSource();
  const connection = new AgentEventConnection({
    createSource: () => source,
    onEvent: () => {},
    shouldMaintain: () => true,
    readinessTimeoutMs: 10_000,
    reconnectDelayMs: 1_000,
    onUnexpectedError: vi.fn(),
  });
  return { connection, source };
}

describe("AgentEventConnection close semantics", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("close() during an in-flight connect rejects with status 'canceled' (intentional teardown)", async () => {
    const { connection, source } = makeConnection();
    const pending = connection.ensureConnected("s1");
    connection.close(); // new conversation / unmount while still CONNECTING
    await expect(pending).rejects.toMatchObject({
      name: "AgentEventConnectionError",
      status: "canceled",
    });
    expect(source.close).toHaveBeenCalled();
  });

  it("stream onerror rejects with status 'closed' (real failure, still alarming)", async () => {
    const { connection, source } = makeConnection();
    const pending = connection.ensureConnected("s1");
    source.onerror?.(new Event("error"));
    await expect(pending).rejects.toMatchObject({
      name: "AgentEventConnectionError",
      status: "closed",
    });
  });

  it("'connected' handshake resolves the pending connect", async () => {
    const { connection, source } = makeConnection();
    const pending = connection.ensureConnected("s1");
    source.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "connected" }) }));
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("AgentEventConnectionError message", () => {
  it("maps statuses to user-facing messages", () => {
    expect(new AgentEventConnectionError("ready_timeout").message).toContain("Timed out");
    expect(new AgentEventConnectionError("closed").message).toContain("Failed to connect");
    expect(new AgentEventConnectionError("canceled").message).toContain("Failed to connect");
  });
});
