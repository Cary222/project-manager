import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { getOrCreateProfile } from "@/features/ai/lib/conversation-store";

export async function GET() {
  try {
    const session = await requireSession();
    const record = await getOrCreateProfile(session.user.id);
    // Unwrap the Prisma row so the client gets the profile JSON directly
    // (rather than the full row including userId/updatedAt/sourceSummaryCount).
    return NextResponse.json({
      data: { profile: record?.profile ?? null },
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}
