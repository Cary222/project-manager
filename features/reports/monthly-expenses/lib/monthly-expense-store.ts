import { prisma } from "@/shared/db/client";
import type { FileAttachment } from "@/features/knowledge/lib/pkm";

export type MonthlyExpenseWithUser = {
  id: string;
  userId: string;
  month: string;
  expenseType: string;
  customType: string | null;
  amount: number;
  description: string;
  attachments: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  shares?: {
    id: string;
    userId: string;
    shareAmount: number;
    user: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
    };
  }[];
};

export type ExpenseType = "TRANSPORT" | "MEAL" | "TRAVEL" | "OFFICE" | "OTHER";

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  TRANSPORT: "交通",
  MEAL: "餐饮",
  TRAVEL: "差旅",
  OFFICE: "办公",
  OTHER: "其他",
};

export const EXPENSE_TYPES = Object.entries(EXPENSE_TYPE_LABELS) as [ExpenseType, string][];

export async function listMyExpenses(
  userId: string,
  opts?: { limit?: number; cursor?: string; month?: string },
): Promise<MonthlyExpenseWithUser[]> {
  // 返回用户创建 或 被分摊的报销单
  const expenses = await prisma.monthlyExpense.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { userId },
        { shares: { some: { userId } } },
      ],
      ...(opts?.month ? { month: opts.month } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      shares: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
    take: (opts?.limit ?? 20) + 1,
    ...(opts?.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    orderBy: { createdAt: "desc" },
  });

  return opts?.cursor ? expenses.slice(0, -1) as MonthlyExpenseWithUser[] : expenses as MonthlyExpenseWithUser[];
}

export async function getExpenseById(id: string): Promise<MonthlyExpenseWithUser | null> {
  const expense = await prisma.monthlyExpense.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      shares: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
  });
  return expense as MonthlyExpenseWithUser | null;
}

export async function createExpense(
  userId: string,
  input: {
    month: string;
    expenseType: ExpenseType;
    customType?: string;
    amount: number;
    description: string;
    attachments?: FileAttachment[] | unknown;
    shares?: { userId: string; shareAmount: number }[];
  },
): Promise<MonthlyExpenseWithUser> {
  let attachments: FileAttachment[] = [];
  if (Array.isArray(input.attachments)) {
    attachments = (input.attachments as FileAttachment[]).filter(
      (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
    );
  }

  // 构建分摊数据：创建者自动包含 + 其他被关联用户
  // shareAmount 为 undefined 时，后续会统一设置为均分值
  const shareData = [
    { userId, shareAmount: 0 }, // 创建者占位，后续计算
    ...(input.shares ?? []).map((s) => ({ userId: s.userId, shareAmount: s.shareAmount ?? 0 })),
  ] as { userId: string; shareAmount: number }[];

  const expense = await prisma.monthlyExpense.create({
    data: {
      userId,
      month: input.month,
      expenseType: input.expenseType,
      customType: input.expenseType === "OTHER" ? (input.customType ?? null) : null,
      amount: input.amount,
      description: input.description,
      attachments: attachments.length > 0 ? attachments : undefined,
      shares: {
        create: shareData.map((s) => ({
          userId: s.userId,
          shareAmount: s.shareAmount,
        })),
      },
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      shares: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
  });

  // 计算每人分摊金额（均分）
  const totalAmount = input.amount;
  const shareCount = expense.shares.length;
  const equalShare = shareCount > 0 ? Math.round((totalAmount / shareCount) * 100) / 100 : 0;

  // 更新分摊金额
  await prisma.expenseShare.updateMany({
    where: { expenseId: expense.id },
    data: { shareAmount: equalShare },
  });

  // 重新获取更新后的数据
  const updated = await prisma.monthlyExpense.findUnique({
    where: { id: expense.id },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      shares: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
  });

  return updated as MonthlyExpenseWithUser;
}

export async function updateExpense(
  id: string,
  userId: string,
  input: Partial<{
    month: string;
    expenseType: ExpenseType;
    customType?: string;
    amount: number;
    description: string;
    attachments: FileAttachment[] | unknown;
    shares: { userId: string; shareAmount: number }[];
  }>,
): Promise<MonthlyExpenseWithUser> {
  const existing = await prisma.monthlyExpense.findFirst({
    where: { id, userId, status: "ACTIVE" },
    include: { shares: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  let attachments: FileAttachment[] | undefined;
  if (input.attachments !== undefined) {
    if (Array.isArray(input.attachments)) {
      attachments = (input.attachments as FileAttachment[]).filter(
        (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
      );
    }
  }

  // 处理分摊更新
  if (input.shares !== undefined) {
    // 保留创建者的分摊记录（更新金额），只删除非创建者的关联
    await prisma.expenseShare.deleteMany({
      where: { expenseId: id, userId: { not: existing.userId } },
    });

    // 计算均分金额
    const totalAmount = input.amount ?? existing.amount;
    const otherShares = input.shares.filter((s) => s.userId !== existing.userId);
    const shareCount = 1 + otherShares.length; // 创建者 + 其他分摊用户
    const equalShare = shareCount > 0 ? Math.round((totalAmount / shareCount) * 100) / 100 : 0;

    // 更新创建者的分摊金额
    await prisma.expenseShare.upsert({
      where: { expenseId_userId: { expenseId: id, userId: existing.userId } },
      update: { shareAmount: equalShare },
      create: { expenseId: id, userId: existing.userId, shareAmount: equalShare },
    });

    // 创建其他分摊用户的关联
    if (otherShares.length > 0) {
      await prisma.expenseShare.createMany({
        data: otherShares.map((s) => ({
          expenseId: id,
          userId: s.userId,
          shareAmount: s.shareAmount ?? equalShare,
        })),
        skipDuplicates: true,
      });
    }
  }

  const updated = await prisma.monthlyExpense.update({
    where: { id },
    data: {
      ...(input.month !== undefined ? { month: input.month } : {}),
      ...(input.expenseType !== undefined ? { expenseType: input.expenseType } : {}),
      ...(input.expenseType !== undefined ? { customType: input.expenseType === "OTHER" ? (input.customType ?? null) : null } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(attachments !== undefined ? { attachments: attachments.length > 0 ? attachments : undefined } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
      shares: {
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
  });

  return updated as MonthlyExpenseWithUser;
}

export async function deleteExpense(id: string, userId: string): Promise<void> {
  // 只有创建者可以删除
  await prisma.monthlyExpense.updateMany({
    where: { id, userId },
    data: { status: "DELETED" },
  });
}
