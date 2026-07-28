import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getExpenseById, updateExpense, deleteExpense } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";

const updateSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "月份格式错误，应为 YYYY-MM").optional(),
  expenseType: z.enum(["TRANSPORT", "MEAL", "TRAVEL", "OFFICE", "OTHER"]).optional(),
  customType: z.string().optional(),
  amount: z.number().positive("金额必须大于 0").optional(),
  description: z.string().min(1, "描述不能为空").optional(),
  attachments: z.array(z.object({
    fileId: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  })).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const expense = await getExpenseById(id);

  if (!expense || expense.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 只能查看自己的报销
  if (expense.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ expense });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    if (data.expenseType === "OTHER" && !data.customType?.trim()) {
      return NextResponse.json(
        { error: "选择「其他」类型时必须填写具体说明" },
        { status: 400 },
      );
    }

    const expense = await updateExpense(id, session.user.id, {
      month: data.month,
      expenseType: data.expenseType,
      customType: data.customType,
      amount: data.amount,
      description: data.description,
      attachments: data.attachments,
    });

    return NextResponse.json({ expense });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await deleteExpense(id, session.user.id);
  return NextResponse.json({ success: true });
}
