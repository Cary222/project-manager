import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/team/[id]/ai-profile
 *
 * Read a single user's AI profile (any user can view any other user's
 * profile — it's the same data the team page shows). Returns:
 *   - 401 if not signed in
 *   - 400 if id is invalid
 *   - 200 with { data: { profile, sourceSummaryCount, updatedAt } | null, error: null }
 *     (data is null when the user has no AI profile yet)
 *   - 500 with { data: null, error: "INTERNAL_ERROR" } on DB failure
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ data: null, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await params;
  const idSchema = z.string().min(1).max(64);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: "INVALID_ID" }, { status: 400 });
  }

  try {
    const record = await prisma.aiUserProfile.findUnique({
      where: { userId: id },
      select: { profile: true, sourceSummaryCount: true, updatedAt: true },
    });

    if (!record) {
      return NextResponse.json({ data: null, error: null });
    }

    return NextResponse.json({
      data: {
        profile: record.profile,
        sourceSummaryCount: record.sourceSummaryCount,
        updatedAt: record.updatedAt,
      },
      error: null,
    });
  } catch (err) {
    console.error("[ai-profile route] DB error:", err);
    return NextResponse.json(
      { data: null, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
