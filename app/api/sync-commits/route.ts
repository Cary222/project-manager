import { NextResponse } from "next/server";
import { syncAllManagedRepos } from "@/lib/git-sync/scan";

export async function POST() {
  try {
    const result = await syncAllManagedRepos();
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
