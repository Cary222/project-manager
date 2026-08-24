import { NextRequest, NextResponse } from "next/server";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

async function getAgentDir(): Promise<string> {
  const { getAgentDir: piGetAgentDir } = await import("@earendil-works/pi-coding-agent");
  return piGetAgentDir();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd: string };
    const { cwd } = body;

    const agentDir = await getAgentDir();
    const status = trustProject(cwd, agentDir);
    return NextResponse.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cwd = searchParams.get("cwd") ?? "";

    const agentDir = await getAgentDir();
    const status = getProjectTrustStatus(cwd, agentDir);
    return NextResponse.json(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
