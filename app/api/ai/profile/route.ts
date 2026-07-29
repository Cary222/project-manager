import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import {
  getOrCreateProfile,
  upsertProfile,
} from "@/features/ai/store/conversation-store";

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

// Allow the user to manually overwrite the profile JSON. The frontend uses
// this to support the "edit the user-summary dropdown" feature. The whole
// `profile` object must be sent (full-replace semantics) so the client owns
// the merge logic and never drops fields silently.
export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const profile = body?.profile;

    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return NextResponse.json(
        { data: null, error: "INVALID_PROFILE" },
        { status: 400 }
      );
    }

    const record = await upsertProfile(session.user.id, profile, 0);
    return NextResponse.json({
      data: { profile: record.profile },
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}
