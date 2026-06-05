import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

const PRIVATE_LIST_CACHE_CONTROL = "private, max-age=30, stale-while-revalidate=60";

export async function GET() {
  try {
    await requireSession();
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });
    return NextResponse.json(
      { users },
      {
        headers: {
          "Cache-Control": PRIVATE_LIST_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
