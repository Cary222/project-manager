import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import {
  listConversations,
  createConversation,
} from "@/features/ai/lib/conversation-store";

const createSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const conversations = await listConversations(session.user.id);
    return NextResponse.json({ data: conversations, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const { title, firstMessage } = createSchema.parse(body);

    const conversation = await createConversation(
      session.user.id,
      title ?? firstMessage
    );

    return NextResponse.json(
      { data: conversation, error: null },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}
