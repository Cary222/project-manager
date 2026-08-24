import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getRpcSession, getRunningRpcSessionIds } from "@/lib/rpc-manager";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const { id } = await params;

    const isRunning = getRunningRpcSessionIds().includes(id);
    const wrapper = getRpcSession(id);

    if (!wrapper || !isRunning) {
      return NextResponse.json({ running: isRunning, state: null });
    }

    const result = (await wrapper.send({ type: "get_state" })) as Record<string, unknown>;

    return NextResponse.json({ running: true, state: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export const dynamic = "force-dynamic";