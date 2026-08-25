import { NextRequest, NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { requireSession } from "@/shared/lib/permissions";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const leafId = searchParams.get("leafId") ?? undefined;
    const deferThinking = searchParams.get("deferThinking") === "1";
    const deferToolResultImages = searchParams.get("deferMedia") === "1";

    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const context = await buildSessionContext(
      sm.getEntries() as never,
      leafId,
      {
        deferThinking,
        deferToolResultImages,
      },
    );

    return NextResponse.json({ context });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export const dynamic = "force-dynamic";
