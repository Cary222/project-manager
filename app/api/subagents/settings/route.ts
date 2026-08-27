import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
} from "@/lib/subagent-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    const settings = readSubagentSettings();
    return NextResponse.json({ enabled: settings.builtInEnabled });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json(
      { error: msg },
      { status },
    );
  }
}

export async function PUT(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const settings = writeBuiltInSubagentsEnabled(body.enabled);
    return NextResponse.json({ enabled: settings.builtInEnabled });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
