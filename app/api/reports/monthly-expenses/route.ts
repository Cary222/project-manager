import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listMyExpenses, createExpense } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";

const createSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "月份格式错误，应为 YYYY-MM"),
  expenseType: z.enum(["TRANSPORT", "MEAL", "TRAVEL", "OFFICE", "OTHER"]),
  customType: z.string().optional(),
  amount: z.number().positive("金额必须大于 0"),
  description: z.string().min(1, "描述不能为空"),
  attachments: z.array(z.object({
    fileId: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
  })).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const cursor = searchParams.get("cursor") ?? undefined;
  const month = searchParams.get("month") ?? undefined;

  const expenses = await listMyExpenses(session.user.id, { limit, cursor, month });
  return NextResponse.json({
    expenses,
    nextCursor: expenses.length === limit ? expenses[expenses.length - 1].id : null,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    if (data.expenseType === "OTHER" && !data.customType?.trim()) {
      return NextResponse.json(
        { error: "选择「其他」类型时必须填写具体说明" },
        { status: 400 },
      );
    }

    const expense = await createExpense(session.user.id, {
      month: data.month,
      expenseType: data.expenseType,
      customType: data.customType,
      amount: data.amount,
      description: data.description,
      attachments: data.attachments,
    });

    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
