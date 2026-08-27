import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getVapidPublicKey } from "@/lib/web-push";
import type { PushConfigResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

// GET /api/push/config - VAPID public key for client-side push subscriptions.
// The private key never leaves the server.
export async function GET(): Promise<Response> {
  try {
    await requireSession();
    const publicKey = await getVapidPublicKey();
    const body: PushConfigResponse = { publicKey };
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
