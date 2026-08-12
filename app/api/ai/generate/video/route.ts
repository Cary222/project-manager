import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { enqueueBackgroundJob } from "@/worker/background/jobs";
import { z } from "zod";

const generateVideoSchema = z.object({
  conversationId: z.string(),
  prompt: z.string().min(1, "Prompt is required"),
  modelName: z.string().optional(),
  // 预留参数（未来支持图生视频）
  imageUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const { conversationId, prompt, modelName, imageUrl } = generateVideoSchema.parse(body);

    // 验证 conversation 归属
    const conversation = await prisma.aiConversation.findUnique({
      where: { id: conversationId, userId: session.user.id },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // 创建 message（executionStatus=QUEUED）
    const message = await prisma.aiChatMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: `正在生成视频...\n提示词：${prompt}`,
        executionStatus: "QUEUED",
        metadata: { prompt, modelName, imageUrl },
      },
      select: { id: true, createdAt: true, executionStatus: true },
    });

    // 更新对话 lastMessageAt
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt, messageCount: { increment: 1 } },
    });

    // enqueue BackgroundJob
    const jobId = await enqueueBackgroundJob({
      type: "VIDEO_GENERATE",
      payload: {
        messageId: message.id,
        userId: session.user.id,
        prompt,
        modelRef: modelName ?? "openai:wan2.7-video",
        imageUrl,
      },
      priority: 50,
      correlationId: message.id,
    });

    console.log(`[api/generate/video] created message=${message.id} job=${jobId}`);

    return NextResponse.json({
      messageId: message.id,
      jobId,
      executionStatus: message.executionStatus,
    });
  } catch (error) {
    console.error("[api/generate/video] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
