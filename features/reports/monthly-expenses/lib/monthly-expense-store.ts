import { prisma } from "@/shared/db/client";
import type { FileAttachment } from "@/shared/lib/pkm";

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
  const expenses = await prisma.monthlyExpense.findMany({
    where: {
      userId,
      status: "ACTIVE",
      ...(opts?.month ? { month: opts.month } : {}),
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
  },
): Promise<MonthlyExpenseWithUser> {
  let attachments: FileAttachment[] = [];
  if (Array.isArray(input.attachments)) {
    attachments = (input.attachments as FileAttachment[]).filter(
      (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
    );
  }

  const expense = await prisma.monthlyExpense.create({
    data: {
      userId,
      month: input.month,
      expenseType: input.expenseType,
      customType: input.expenseType === "OTHER" ? (input.customType ?? null) : null,
      amount: input.amount,
      description: input.description,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
  });

  return expense as MonthlyExpenseWithUser;
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
  }>,
): Promise<MonthlyExpenseWithUser> {
  const existing = await prisma.monthlyExpense.findFirst({ where: { id, userId, status: "ACTIVE" } });
  if (!existing) throw new Error("NOT_FOUND");

  let attachments: FileAttachment[] | undefined;
  if (input.attachments !== undefined) {
    if (Array.isArray(input.attachments)) {
      attachments = (input.attachments as FileAttachment[]).filter(
        (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
      );
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
  });

  return updated as MonthlyExpenseWithUser;
}

export async function deleteExpense(id: string, userId: string): Promise<void> {
  await prisma.monthlyExpense.updateMany({
    where: { id, userId },
    data: { status: "DELETED" },
  });
}
