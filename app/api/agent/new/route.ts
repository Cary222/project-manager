import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { startRpcSession } from "@/lib/rpc-manager";
import type { RpcSessionStartOptions } from "@/lib/rpc-manager";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      cwd?: string;
      toolNames?: string[];
      model?: { provider: string; modelId: string };
      thinkingLevel?: string;
    };

    if (!body.cwd) {
      return NextResponse.json(
        { error: "cwd is required", code: "missing_cwd" },
        { status: 400 },
      );
    }

    const sessionId = randomUUID();
    const options: RpcSessionStartOptions = {
      toolNames: body.toolNames,
      initialModel: body.model,
      thinkingLevel: body.thinkingLevel as RpcSessionStartOptions["thinkingLevel"],
    };

    const { session, realSessionId } = await startRpcSession(
      sessionId,
      "", // empty sessionFile for new session
      body.cwd,
      options,
    );

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
