import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getSessionsIndex, getRunningSessionIds } from "@/lib/pi-types";

export async function GET() {
  try {
    const session = await requireSession();
    const sessions = await getSessionsIndex();
    const runningSessionIds = getRunningSessionIds();
    return NextResponse.json({ sessions, runningSessionIds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const stack = err instanceof Error ? err.stack : "";
    console.error("[/api/sessions] Error:", msg, stack);
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: msg, stack }, { status });
  }
}
