"use server";

import { prisma } from "@/shared/db/client";
import { Prisma } from "@prisma/client";

export interface ConversationWithMessages {
  id: string;
  userId: string;
  title: string;
  summary: unknown;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  messages: AiChatMessage[];
}

export interface AiChatMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  sources: unknown;
  metadata: unknown;
  createdAt: Date;
}

export interface ConversationListItem {
  id: string;
  userId: string;
  title: string;
  summary: unknown;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}

export interface UserProfile {
  userId: string;
  profile: Prisma.JsonValue;
  sourceSummaryCount: number;
  updatedAt: Date;
  createdAt: Date;
}

export async function createConversation(
  userId: string,
  firstMessage?: string
): Promise<ConversationListItem> {
  const title = firstMessage
    ? firstMessage.slice(0, 20) + (firstMessage.length > 20 ? "..." : "")
    : "新对话";

  const conversation = await prisma.aiConversation.create({
    data: {
      userId,
      title,
    },
  });

  return conversation;
}

export async function appendMessage(
  conversationId: string,
  role: string,
  content: string,
  sources?: unknown,
  metadata?: unknown
): Promise<AiChatMessage> {
  const [message] = await prisma.$transaction([
    prisma.aiChatMessage.create({
      data: {
        conversationId,
        role,
        content,
        sources: sources ?? Prisma.JsonNull,
        metadata: metadata ?? Prisma.JsonNull,
      },
    }),
    prisma.aiConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
      },
    }),
  ]);

  return message;
}

export async function getMessages(
  conversationId: string,
  limit: number = 50,
  before?: Date
): Promise<AiChatMessage[]> {
  const where: Prisma.AiChatMessageWhereInput = {
    conversationId,
    ...(before ? { createdAt: { lt: before } } : {}),
  };

  return prisma.aiChatMessage.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function listConversations(
  userId: string,
  limit: number = 50,
  category?: "CHAT" | "WORK"
): Promise<ConversationListItem[]> {
  return prisma.aiConversation.findMany({
    where: {
      userId,
      ...(category ? { category } : {}),
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
  });
}

export async function deleteConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });

  if (!conversation || conversation.userId !== userId) {
    throw new Error("NOT_FOUND");
  }

  await prisma.aiConversation.delete({
    where: { id: conversationId },
  });
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string
): Promise<ConversationListItem> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });

  if (!conversation || conversation.userId !== userId) {
    throw new Error("NOT_FOUND");
  }

  return prisma.aiConversation.update({
    where: { id: conversationId },
    data: { title },
  });
}

export async function getConversation(
  conversationId: string,
  userId: string
): Promise<ConversationListItem | null> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation || conversation.userId !== userId) {
    return null;
  }

  return conversation;
}

export async function getOrCreateProfile(
  userId: string
): Promise<UserProfile | null> {
  return prisma.aiUserProfile.findUnique({
    where: { userId },
  });
}

export async function upsertProfile(
  userId: string,
  profile: Prisma.InputJsonValue,
  sourceSummaryCount: number
): Promise<UserProfile> {
  return prisma.aiUserProfile.upsert({
    where: { userId },
    create: {
      userId,
      profile,
      sourceSummaryCount,
    },
    update: {
      profile,
      sourceSummaryCount,
    },
  });
}

export async function getConversationsWithMessages(
  conversationId: string,
  userId: string
): Promise<ConversationWithMessages | null> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation || conversation.userId !== userId) {
    return null;
  }

  const messages = await prisma.aiChatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      conversationId: true,
      role: true,
      content: true,
      sources: true,
      metadata: true,
      createdAt: true,
      executionStatus: true,
      attachments: {
        select: {
          id: true,
          type: true,
          fileAssetId: true,
          direction: true,
        },
      },
    },
  });

  return {
    ...conversation,
    messages,
  };
}

export async function getConversationSummaries(
  userId: string,
  limit: number = 20
): Promise<{ id: string; summary: unknown }[]> {
  const conversations = await prisma.aiConversation.findMany({
    where: {
      userId,
      summary: { not: Prisma.JsonNull },
    },
    select: { id: true, summary: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return conversations.map((c) => ({ id: c.id, summary: c.summary }));
}
