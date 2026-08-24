import {
  getRunningRpcSessionIds,
  subscribeRunningSessions,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
export async function GET(req: Request) {
  if (req.signal?.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  const sendData = (data: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  let controller: ReadableStreamDefaultController<Uint8Array>;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;

      // Subscribe before reading the snapshot so we never miss a transition
      // through the gap between snapshot and subscription.
      unsubscribe = subscribeRunningSessions((ids) => {
        if (closed) return;
        try {
          sendData({ runningSessionIds: ids });
        } catch {
          cleanup();
        }
      });

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      try {
        sendData({ runningSessionIds: getRunningRpcSessionIds() });
      } catch {
        cleanup();
        return;
      }

      // Heartbeat to keep the connection alive through proxies/timeouts.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 25_000);
    },
    cancel() {
      cleanup();
    },
  });

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    try {
      controller?.close();
    } catch {
      // already closed
    }
  };

  req.signal?.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
