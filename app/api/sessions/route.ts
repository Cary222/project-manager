import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getSessionsIndex, getRunningSessionIds } from "@/lib/pi-types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    // 与 pi-web 对齐：支持 ?force=1 跳过会话列表 TTL 缓存
    const force = new URL(request.url).searchParams.get("force") === "1";
    const sessions = await getSessionsIndex({ force });
    const runningSessionIds = getRunningSessionIds();
    return NextResponse.json(
      { sessions, runningSessionIds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const stack = err instanceof Error ? err.stack : "";
    console.error("[/api/sessions] Error:", msg, stack);
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: msg, stack }, { status });
  }
}
