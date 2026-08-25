import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache } from "@/lib/session-reader";
import type { RpcSessionStartOptions } from "@/lib/rpc-manager";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      toolNames?: string[];
      // 与 pi-web / useAgentSession.ensureNewSession 对齐：扁平字段
      provider?: string;
      modelId?: string;
      thinkingLevel?: string;
    };

    if (!body.cwd) {
      return NextResponse.json(
        { error: "cwd is required", code: "missing_cwd" },
        { status: 400 },
      );
    }

    const initialModel =
      body.provider && body.modelId
        ? { provider: body.provider, modelId: body.modelId }
        : undefined;
    const sessionId = randomUUID();
    const options: RpcSessionStartOptions = {
      toolNames: body.toolNames,
      initialModel,
      thinkingLevel: body.thinkingLevel as RpcSessionStartOptions["thinkingLevel"],
    };

    const { session, realSessionId } = await startRpcSession(
      sessionId,
      "", // empty sessionFile for new session
      body.cwd,
      options,
    );
    // 与 pi-web 对齐：新会话立即可见于会话列表，不等 30s TTL 缓存过期
    invalidateSessionListCache();

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      sessionFile: session.sessionFile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[/api/agent/new] Error:", message);

    return NextResponse.json(
      { error: message, code: "create_session_error" },
      { status: 500 },
    );
  }
}
