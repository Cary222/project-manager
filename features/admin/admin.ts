"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/shared/db/client";
import { requireRoot } from "@/shared/lib/permissions";
import { createModerationLog } from "@/features/admin/moderation";
import { UserRole, ModerationAction, TicketStatus } from "@prisma/client";

export type UserSummary = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  bannedAt: Date | null;
  createdAt: Date;
};

export async function getUserByIdAction(userId: string) {
  await requireRoot();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, bannedAt: true, createdAt: true },
  });
  if (!user) return null;
  return user;
}

export type UserTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  project: { id: string; name: string };
  module: { name: string; responsibility: { kind: "PROGRAM" | "DESIGN" | "BUG" } };
};

export async function getUserTicketsAction(userId: string, status?: TicketStatus) {
  await requireRoot();
  const tickets = await prisma.ticket.findMany({
    where: {
      assignees: { some: { userId } },
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { ticketNo: "desc" }],
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      project: { select: { id: true, name: true } },
      module: {
        select: {
          name: true,
          responsibility: { select: { kind: true } },
        },
      },
    },
  });
  return tickets;
}

export async function getUsersAction(params?: {
  search?: string;
  role?: UserRole;
  page?: number;
}): Promise<{ users: UserSummary[]; total: number }> {
  await requireRoot();

  const { search = "", role, page = 1 } = params ?? {};
  const pageSize = 20;
  const skip = (page - 1) * pageSize;

  const where = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(role ? { role } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        bannedAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}

export async function updateUserRoleAction(
  userId: string,
  role: UserRole
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireRoot();

  if (userId === session.user.id) {
    return { error: "不能修改自己的角色" };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "用户不存在" };

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  await createModerationLog({
    action: ModerationAction.UPDATE_ROLE,
    targetId: userId,
    targetType: "User",
    actorId: session.user.id,
    reason: `角色变更为 ${role}`,
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function banUserAction(
  userId: string,
  reason?: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireRoot();

  if (userId === session.user.id) {
    return { error: "不能封禁自己" };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "用户不存在" };
  if (target.role === UserRole.ROOT) {
    return { error: "不能封禁 ROOT 用户" };
  }
  if (target.bannedAt) {
    return { error: "该用户已被封禁" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { bannedAt: new Date() },
  });

  await createModerationLog({
    action: ModerationAction.BAN_USER,
    targetId: userId,
    targetType: "User",
    actorId: session.user.id,
    reason,
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function unbanUserAction(
  userId: string
): Promise<{ success?: boolean; error?: string }> {
  const session = await requireRoot();

  if (userId === session.user.id) {
    return { error: "不能解封自己" };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "用户不存在" };
  if (!target.bannedAt) {
    return { error: "该用户未被封禁" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { bannedAt: null },
  });

  await createModerationLog({
    action: ModerationAction.UNBAN_USER,
    targetId: userId,
    targetType: "User",
    actorId: session.user.id,
  });

  revalidatePath("/admin/users");
  return { success: true };
}
