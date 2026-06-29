import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import {
  getConversationsWithMessages,
  deleteConversation,
  renameConversation,
} from "@/features/ai/lib/conversation-store";
import { enqueueSummarizeConversation } from "@/features/ai/lib/background-jobs";

const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  })
  .refine((data) => data.title !== undefined || data.tags !== undefined, {
    message: "Must provide at least one of: title, tags",
  });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const conversation = await getConversationsWithMessages(id, session.user.id);

    if (!conversation) {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }

    // If this conversation has never been summarized (or its last summary is
    // stale) and it has enough messages to summarize, kick off a background
    // summarize so it eventually contributes to the user profile.
    //
    // enqueueSummarizeConversation respects a cooldown window, so repeatedly
    // opening the same conversation won't spam the LLM.
    const hasSummary = conversation.summary != null;
    const enoughMessages = conversation.messages.length >= 4;
    if (!hasSummary && enoughMessages) {
      enqueueSummarizeConversation(id);
    }

    return NextResponse.json({ data: conversation, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    // Ownership check first so a malicious caller can't probe tags on a
    // conversation that doesn't belong to them.
    const existing = await prisma.aiConversation.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Branch: tags-only update (used by the per-tag × button in the sidebar)
    if (parsed.tags !== undefined) {
      const updated = await prisma.aiConversation.update({
        where: { id },
        data: { tags: parsed.tags },
      });
      return NextResponse.json({ data: updated, error: null });
    }

    // Otherwise, treat it as a rename. Keep `renameConversation` as the
    // single source of truth for title mutations so the ownership check and
    // 404 behavior stay identical to before.
    if (parsed.title !== undefined) {
      const conversation = await renameConversation(
        id,
        session.user.id,
        parsed.title
      );
      return NextResponse.json({ data: conversation, error: null });
    }

    // Unreachable thanks to the .refine() guard, but keep a defensive branch.
    return NextResponse.json(
      { data: null, error: "Nothing to update" },
      { status: 400 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg === "NOT_FOUND") {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    await deleteConversation(id, session.user.id);
    return NextResponse.json({ data: { deleted: true }, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg === "NOT_FOUND") {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}
