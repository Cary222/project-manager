import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decideGlobalMode } from "@/features/ai/routing/global-mode-router";
import { requireSession } from "@/shared/lib/permissions";

const requestSchema = z.object({
  input: z.string().min(1),
  currentRoute: z.enum(["chat", "work"]).optional(),
  conversationId: z.string().optional(),
  projectId: z.string().optional(),
  ticketId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const parsed = requestSchema.parse(body);

    const decision = await decideGlobalMode(parsed.input, {
      userId: session.user.id,
      currentRoute: parsed.currentRoute,
      conversationId: parsed.conversationId,
      projectId: parsed.projectId,
      ticketId: parsed.ticketId,
    });

    return NextResponse.json({ data: decision, error: null });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Routing decision failed";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: message }, { status });
  }
}
