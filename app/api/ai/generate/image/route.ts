import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { enqueueBackgroundJob } from "@/worker/background/jobs";
import { z } from "zod";

const generateImageSchema = z.object({
  conversationId: z.string(),
  prompt: z.string().min(1, "Prompt is required"),
  modelName: z.string().optional(),
  n: z.number().int().min(1).max(4).optional().default(1), // 生成张数（预留多图）
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const { conversationId, prompt, modelName, n } = generateImageSchema.parse(body);

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
        content: `正在生成图片...\n提示词：${prompt}`,
        executionStatus: "QUEUED",
        metadata: { prompt, modelName, n },
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
      type: "IMAGE_GENERATE",
      payload: {
        messageId: message.id,
        userId: session.user.id,
        prompt,
        modelRef: modelName ?? "openai:wan2.7-image",
        n,
      },
      priority: 50,
      correlationId: message.id,
    });

    console.log(`[api/generate/image] created message=${message.id} job=${jobId}`);

    return NextResponse.json({
      messageId: message.id,
      jobId, // 前端可选择性展示 job 追踪（debug 用）
      executionStatus: message.executionStatus,
    });
  } catch (error) {
    console.error("[api/generate/image] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
