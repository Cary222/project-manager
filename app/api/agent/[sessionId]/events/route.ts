import { createAgentEventStream } from "@/lib/agent-event-stream";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[sessionId]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId: id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  // Fast path: already-running session
  let sessionPromise;
  const session = getRpcSession(id);
  if (session?.isAlive()) {
    sessionPromise = Promise.resolve(session);
  } else {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    if (req.signal.aborted) return new Response(null, { status: 204 });
    sessionPromise = startRpcSession(id, filePath, undefined).then((result) => result.session);
  }

  const stream = createAgentEventStream(req, id, sessionPromise);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
