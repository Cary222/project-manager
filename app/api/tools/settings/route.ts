import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({
      isWindows: process.platform === "win32",
      powerShellEnabled: await readPowerShellToolEnabled(),
    });
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
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "PowerShell tool settings are only available on Windows" }, { status: 404 });
  }

  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    return NextResponse.json({
      isWindows: true,
      powerShellEnabled: await writePowerShellToolEnabled(body.enabled),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
