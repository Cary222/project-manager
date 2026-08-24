import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getRealtimeConfig } from "@/features/ai/llm/providers/audio/realtime/dashscope";

/**
 * POST /api/ai/audio/realtime/config
 * 获取 DashScope Realtime 配置（WebSocket URL + 认证 cookie）
 *
 * 注意：WebSocket 无法传递自定义 headers，改用 HttpOnly cookie 认证
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

    const response = NextResponse.json({ data: config, error: null });

    // 如果有 token，设置 HttpOnly cookie（WebSocket 认证用）
    if (config.token) {
      response.cookies.set("dashscope_realtime_token", config.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 5, // 5 分钟
        path: "/",
      });
    }

    return response;
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
