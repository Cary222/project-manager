import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const message = await prisma.aiChatMessage.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        content: true,
        executionStatus: true,
        errorMessage: true,
        metadata: true, // 包含 progress
        createdAt: true,
        updatedAt: true,
        conversation: {
          select: { userId: true },
        },
        attachments: {
          select: {
            id: true,
            type: true,
            fileAssetId: true,
            jobOutputId: true,
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // 权限检查：必须是对话所有者
    if (message.conversation.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { conversation: _, ...rest } = message;
    return NextResponse.json(rest);
  } catch (error) {
    console.error("[api/messages/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
