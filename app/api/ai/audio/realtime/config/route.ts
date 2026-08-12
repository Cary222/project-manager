import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getRealtimeConfig } from "@/features/ai/audio/realtime/dashscope";

/**
 * POST /api/ai/audio/realtime/config
 * 获取 DashScope Realtime 配置（WebSocket URL + token）
 */
export async function POST() {
  try {
    const session = await requireSession().catch(() => null);
    if (!session?.user) {
      return NextResponse.json(
        { data: null, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const config = await getRealtimeConfig(session.user.id);

    return NextResponse.json({ data: config, error: null });
  } catch (error) {
    console.error("[POST /api/ai/audio/realtime/config] error:", error);

    const message =
      error instanceof Error ? error.message : "Realtime 暂不可用";

    return NextResponse.json(
      { data: null, error: message },
      { status: 503 }
    );
  }
}
