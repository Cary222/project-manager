import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import {
  listConversations,
  createConversation,
} from "@/features/ai/store/conversation-store";

const createSchema = z.object({
  title: z.string().optional(),
  firstMessage: z.string().optional(),
  /**
   * C1 fix: 首条消息附带的图片资源 id（AiFileAsset.id）。
   * 与 firstMessage 一起持久化为 user message 的 INPUT attachments。
   * 与 /api/ai/conversations/[id]/messages 的 inputImageIds 走同一 schema 上限（max(8)）。
   */
  inputImageIds: z.array(z.string()).max(8).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const category = searchParams.get("category") as "CHAT" | "WORK" | null;
    const conversations = await listConversations(session.user.id, safeLimit, category ?? undefined);
    const serialized = conversations.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      lastMessageAt: c.lastMessageAt.toISOString(),
    }));
    return NextResponse.json({ data: serialized, error: null });
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
    const { title, firstMessage, inputImageIds } = createSchema.parse(body);

    // C1 fix: 校验 inputImageIds 全部归当前用户所有（ownerId = userId）。
    // 校验失败返回 403/400，不创建对话，避免孤儿对话。
    let validatedInputImages: Array<{ id: string; storageType: string; mimeType: string | null }> = [];
    if (inputImageIds && inputImageIds.length > 0) {
      validatedInputImages = await validateInputImageOwnership(
        inputImageIds,
        session.user.id,
      );
    }

    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.aiConversation.create({
        data: {
          userId: session.user.id,
          title: title ?? firstMessage ?? "新对话",
        },
      });
      // C1 fix: 首条消息持久化（与 /messages 路由的 LangGraph 分支保持一致语义）
      // 当前轮次消息 = firstMessage；INPUT 附件 = inputImageIds
      if (firstMessage && validatedInputImages.length > 0) {
        const created = await tx.aiChatMessage.create({
          data: {
            conversationId: conv.id,
            role: "user",
            content: firstMessage,
          },
          select: { id: true },
        });
        await tx.aiMessageAttachment.createMany({
          data: validatedInputImages.map((img) => ({
            messageId: created.id,
            fileAssetId: img.id,
            type: "IMAGE",
            direction: "INPUT",
          })),
        });
      } else if (firstMessage) {
        // 无图片但有 firstMessage：仅写消息（向后兼容旧调用）
        await tx.aiChatMessage.create({
          data: {
            conversationId: conv.id,
            role: "user",
            content: firstMessage,
          },
        });
      }
      // C1 fix: 输入图片有，但 firstMessage 为空 → 不写空消息（attachments 无 messageId 会触发外键约束）
      // 退化为"创建空对话"——前端应避免这种调用。
      if (firstMessage) {
        await tx.aiConversation.update({
          where: { id: conv.id },
          data: {
            lastMessageAt: new Date(),
            messageCount: { increment: 1 },
          },
        });
      }
      return conv;
    });

    return NextResponse.json(
      {
        data: {
          ...conversation,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          lastMessageAt: conversation.lastMessageAt.toISOString(),
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    // W8: 把 validateInputImageOwnership 抛出的业务错误映射成 4xx
    const msg = err instanceof Error ? err.message : "unknown";
    if (msg.startsWith("UNAUTHORIZED_INPUT_IMAGE")) {
      const missingIds = msg.replace(/^UNAUTHORIZED_INPUT_IMAGE:\s*/, "").split(",").filter(Boolean);
      console.warn(
        `[route:conversations] inputImageIds ownership validation failed: missingIds=${JSON.stringify(missingIds)}`
      );
      return NextResponse.json(
        { data: null, error: "图片资源不属于当前用户" },
        { status: 403 }
      );
    }
    if (msg.startsWith("NON_IMAGE_INPUT")) {
      console.warn(
        `[route:conversations] inputImageIds contains non-image assets`
      );
      return NextResponse.json(
        { data: null, error: "输入必须为图片文件" },
        { status: 400 }
      );
    }
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}

/**
 * C1 fix: 校验 inputImageIds 全部归当前用户所有（ownerId = userId）。
 * 校验通过返回完整 AiFileAsset 列表（带 storageType/mimeType 供后续 resolve）。
 * 校验失败抛错（含 missingIds，调用方返回 403）。
 *
 * 本函数复制自 /messages 路由的同名函数；保持同语义、不抽公共模块（两个路由独立演进）。
 */
async function validateInputImageOwnership(
  inputImageIds: string[],
  userId: string,
): Promise<Array<{ id: string; storageType: string; mimeType: string | null }>> {
  const assets = await prisma.aiFileAsset.findMany({
    where: { id: { in: inputImageIds } },
    select: { id: true, storageType: true, mimeType: true, ownerId: true },
  });
  const owned = assets.filter((a) => a.ownerId === userId);
  if (owned.length !== inputImageIds.length) {
    const ownedIds = new Set(owned.map((a) => a.id));
    const missingIds = inputImageIds.filter((id) => !ownedIds.has(id));
    throw new Error(`UNAUTHORIZED_INPUT_IMAGE: ${missingIds.join(",")}`);
  }
  // 必须是图片
  const nonImage = owned.filter((a) => !a.mimeType?.startsWith("image/"));
  if (nonImage.length > 0) {
    throw new Error(`NON_IMAGE_INPUT: ${nonImage.map((a) => a.id).join(",")}`);
  }
  return owned;
}