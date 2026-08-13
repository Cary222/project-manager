import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import { enqueueBackgroundJob } from "@/worker/background/jobs";
import { z } from "zod";
import { resolveGenerationMode } from "@/features/ai/routing/generation-mode";

const generateVideoSchema = z.object({
  conversationId: z.string(),
  prompt: z.string().min(1, "Prompt is required"),
  modelName: z.string().optional(),
  inputFileIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  console.log("[DEBUG-video-route] POST /api/ai/generate/video called, url:", req.url);
  try {
    const session = await requireSession();
    console.log("[DEBUG-video-route] session ok, userId:", session.user.id);
    const body = await req.json();
    console.log("[DEBUG-video-route] body:", JSON.stringify(body));
    const { conversationId, prompt, modelName, inputFileIds } = generateVideoSchema.parse(body);

    // 计算生成模式
    const generationMode = resolveGenerationMode("video", inputFileIds);

    // I2V 模式必须有输入图片
    if (generationMode === "IMAGE_TO_VIDEO" && (!inputFileIds || inputFileIds.length === 0)) {
      return NextResponse.json(
        { error: "IMAGE_TO_VIDEO mode requires at least one input image" },
        { status: 400 }
      );
    }

    // 第一版限制：最多 1 张输入图
    if (inputFileIds && inputFileIds.length > 1) {
      return NextResponse.json(
        { error: "Current version supports maximum 1 input image" },
        { status: 400 }
      );
    }

    // 验证输入文件（如果提供了的话）
    if (inputFileIds && inputFileIds.length > 0) {
      // 安全：验证文件存在即可
      // 注：参考图上传时已有会话权限控制，无需 attachment 关系
      const inputFiles = await prisma.aiFileAsset.findMany({
        where: {
          id: { in: inputFileIds },
        },
        select: {
          id: true,
          mimeType: true,
        },
      });

      // 检查是否全部找到
      if (inputFiles.length !== inputFileIds.length) {
        return NextResponse.json(
          { error: "One or more input files not found" },
          { status: 404 }
        );
      }

      // 检查类型必须为 image/*
      const nonImageFiles = inputFiles.filter(
        (file) => !file.mimeType?.startsWith("image/")
      );
      if (nonImageFiles.length > 0) {
        return NextResponse.json(
          { error: "All input files must be images (image/* mime type)" },
          { status: 400 }
        );
      }
    }

    // 验证 conversation 归属
    const conversation = await prisma.aiConversation.findUnique({
      where: { id: conversationId, userId: session.user.id },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    console.log("[DEBUG-video-route] conversation found, about to enqueue job");

    // 先存用户消息
    const userMessage = await prisma.aiChatMessage.create({
      data: {
        conversationId,
        role: "user",
        content: prompt,
      },
      select: { id: true, createdAt: true },
    });

    // 如果有输入图片，为用户消息创建 INPUT 附件
    if (inputFileIds && inputFileIds.length > 0) {
      await prisma.aiMessageAttachment.createMany({
        data: inputFileIds.map((fileAssetId) => ({
          messageId: userMessage.id,
          fileAssetId,
          type: "IMAGE",
          direction: "INPUT",
        })),
      });
    }

    // 创建 assistant 消息（executionStatus=QUEUED）
    const message = await prisma.aiChatMessage.create({
      data: {
        conversationId,
        role: "assistant",
        content: `正在生成视频...\n提示词：${prompt}`,
        executionStatus: "QUEUED",
        metadata: { prompt, modelName, inputFileIds },
      },
      select: { id: true, createdAt: true, executionStatus: true },
    });

    // 更新对话 lastMessageAt（算用户+AI 两条）
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt, messageCount: { increment: 2 } },
    });

    // enqueue BackgroundJob
    const jobId = await enqueueBackgroundJob({
      type: "VIDEO_GENERATE",
      payload: {
        messageId: message.id,
        userId: session.user.id,
        prompt,
        modelRef: modelName ?? "agnes:agnes-video-v2.0",
        inputFileIds: inputFileIds ?? [],
      },
      priority: 50,
      correlationId: message.id,
    });

    console.log(`[api/generate/video] created message=${message.id} job=${jobId} mode=${generationMode}`);

    return NextResponse.json({
      messageId: message.id,
      jobId,
      executionStatus: message.executionStatus,
    });
  } catch (error) {
    console.error("[DEBUG-video-route] error:", error);
    console.error("[DEBUG-video-route] error name:", error instanceof Error ? error.constructor.name : typeof error);
    if (error instanceof Error) {
      console.error("[DEBUG-video-route] error message:", error.message);
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      console.error("[DEBUG-video-route] UNAUTHORIZED - returning 401");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
