import { NextResponse } from "next/server";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { requireSession } from "@/shared/lib/permissions";
import { allowFileRoot } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession } from "@/lib/rpc-manager";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  throw new Error(`Invalid thinking level: ${String(value)}`);
}

// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns pi's real session id plus the model/thinking state selected at startup.
export async function POST(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let commandType: string | undefined;
  let promptAccepted = false;
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;
    commandType = typeof command.type === "string" ? command.type : undefined;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({
        error: "cwd is required",
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({
        error: `Directory does not exist: ${cwd}`,
        ...(commandType === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 400 });
    }

    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as {
      provider?: string;
      modelId?: string;
      toolNames?: string[];
      thinkingLevel?: unknown;
      [key: string]: unknown;
    };
    if ((provider && !modelId) || (!provider && modelId)) {
      throw new Error("provider and modelId must be provided together");
    }
    const explicitThinkingLevel = parseThinkingLevel(thinkingLevel);

    const tempKey = `__new__${randomUUID()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, {
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(explicitThinkingLevel ? { thinkingLevel: explicitThinkingLevel } : {}),
    });

    allowFileRoot(cwd);
    invalidateSessionListCache();

    const state = await session.send({ type: "get_state" }) as {
      model?: { id: string; provider: string };
      thinkingLevel?: string;
    };

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({
        success: true,
        sessionId: realSessionId,
        data: null,
        model: state.model
          ? { provider: state.model.provider, modelId: state.model.id }
          : null,
        thinkingLevel: state.thinkingLevel,
      });
    }

    const result = await session.send(promptCommand);
    promptAccepted = promptCommand.type === "prompt";

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      data: result,
      model: state.model
        ? { provider: state.model.provider, modelId: state.model.id }
        : null,
      thinkingLevel: state.thinkingLevel,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: 500 });
  }
}
