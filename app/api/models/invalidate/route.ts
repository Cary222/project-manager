import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { resetModelRuntime } from "@/lib/model-discovery";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    invalidateModelsCache();
    resetModelRuntime();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
