import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isRoot } from "@/shared/lib/permissions-client";
import { getModerationLogs } from "@/features/admin/moderation";

export async function GET() {
  const session = await auth();
  if (!session?.user || !isRoot(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const logs = await getModerationLogs(100);
  return NextResponse.json({ logs });
}
