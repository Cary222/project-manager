import { NextResponse } from "next/server";
import { ModerationAction } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import {
  buildMentionedNotification,
} from "@/features/admin/notifications-lib";
import { syncTicketSearchDocument } from "@/shared/lib/search";

type RouteParams = { params: Promise<{ id: string }> };

const MENTION_PATTERN = /@\[([^\]]+)\]\(([^\)]+)\)/g;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractMentionedIdentifiers(content: string): string[] {
  const values = new Set<string>();
  MENTION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_PATTERN.exec(content)) !== null) {
    const raw = match[2]?.trim();
    if (!raw) continue;
    if (EMAIL_PATTERN.test(raw)) {
      values.add(raw.toLowerCase());
    }
  }
  return [...values];
}

function stripMentionSyntax(content: string): string {
  return content.replace(MENTION_PATTERN, (_full, name) => `@${name}`).trim();
}

function makeExcerpt(content: string, max = 80): string {
  const text = stripMentionSyntax(content).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    await requireSession();
    const { id } = await params;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findFirst({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id: id },
      select: { id: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const comments = await prisma.ticketComment.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        author: { select: { id: true, name: true, email: true } },
      },
    });

    // 一次性查所有被 @ 的用户，构建 mentionedUsers 字段（email → {id, name}）
    // 不改 schema：在响应层补充，前端 MarkdownContent 用它把 `@[name](email)`
    // 渲染成跳 `/team/<id>` 的链接，而不是默认的 `<a href="email">`。
    const allMentionedIds = [
      ...new Set(comments.flatMap((c) => c.mentionedUserIds ?? [])),
    ];
    const mentionedUsers = allMentionedIds.length
      ? await prisma.user.findMany({
          where: { id: { in: allMentionedIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const mentionedUserById = new Map(mentionedUsers.map((u) => [u.id, u]));
    const enriched = comments.map((c) => ({
      ...c,
      mentionedUsers: (c.mentionedUserIds ?? [])
        .map((id) => mentionedUserById.get(id))
        .filter((u): u is { id: string; name: string | null; email: string } => Boolean(u)),
    }));

    return NextResponse.json({ comments: enriched });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const ticketNo = Number(id);

    const body = (await request.json().catch(() => ({}))) as {
      content?: unknown;
    };

    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    const content = body.content.trim();
    if (content.length === 0) {
      return NextResponse.json({ error: "content cannot be empty" }, { status: 400 });
    }
    if (content.length > 5000) {
      return NextResponse.json(
        { error: "content too long (max 5000 chars)" },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.findFirst({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id: id },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        module: {
          select: {
            responsibility: { select: { kind: true } },
          },
        },
        assignees: { select: { userId: true } },
      },
    });
    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const isRoot = session.user.role === "ROOT";

    // 权限校验:ROOT 或当前工单所属责任区的责任人均可评论
    let isAuthorisedCommenter = isRoot;
    if (!isAuthorisedCommenter) {
      const myResps = await prisma.userResponsibility.findMany({
        where: { userId: session.user.id },
        select: { kind: true },
      });
      const myKinds = new Set(myResps.map((r) => r.kind));
      isAuthorisedCommenter = myKinds.has(ticket.module.responsibility.kind);
    }
    if (!isAuthorisedCommenter) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const mentionedEmails = extractMentionedIdentifiers(content);

    let validatedMentionedIds: string[] = [];
    if (mentionedEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: mentionedEmails } },
        select: { id: true },
      });
      validatedMentionedIds = users.map((u) => u.id);
    }

    const created = await prisma.$transaction(async (tx) => {
      const comment = await tx.ticketComment.create({
        data: {
          ticketId: ticket.id,
          authorId: session.user.id,
          content,
          mentionedUserIds: validatedMentionedIds,
        },
        include: {
          author: { select: { id: true, name: true, email: true } },
        },
      });
      await tx.moderationLog.create({
        data: {
          action: ModerationAction.EDIT_TICKET,
          targetId: comment.id,
          targetType: "TicketComment",
          actorId: session.user.id,
          reason: `在单子 #${ticket.ticketNo} 发布备注`,
        },
      });
      return comment;
    });

    await syncTicketSearchDocument(ticket.id);

    // 给被 @ 的人发通知(去重,不发给作者自己),用 createMany 避免 N+1
    const recipientIds = [
      ...new Set(validatedMentionedIds.filter((uid) => uid !== session.user.id)),
    ];
    if (recipientIds.length > 0) {
      try {
        const actorName = session.user.name || session.user.email || "团队成员";
        const excerpt = makeExcerpt(content);
        const { title, content: notificationContent } = buildMentionedNotification({
          ticketNo: ticket.ticketNo,
          title: ticket.title,
          actorName,
          excerpt,
        });
        await prisma.notification.createMany({
          data: recipientIds.map((userId) => ({
            userId,
            type: "TICKET_MENTIONED" as const,
            title,
            content: notificationContent,
            ticketId: ticket.id,
            actorId: session.user.id,
          })),
        });
      } catch (notifyError) {
        console.error("Failed to create mention notifications", notifyError);
      }
    }

    return NextResponse.json({ comment: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
