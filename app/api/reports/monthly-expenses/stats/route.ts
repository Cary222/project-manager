import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";

export const dynamic = "force-dynamic";

/**
 * 获取指定月份的全员报销统计。
 *
 * Query params:
 *   - month: YYYY-MM 格式，如 "2026-07"（默认本月）
 *
 * 用于 Dashboard 中展示任意月的报销情况。
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let month = searchParams.get("month") ?? undefined;

    // 默认本月
    if (!month) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }

    // 验证月份格式
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: "月份格式错误，应为 YYYY-MM" },
        { status: 400 },
      );
    }

    // 查询当月所有报销
    const expenses = await prisma.monthlyExpense.findMany({
      where: {
        month,
        status: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    // 按类型汇总
    const typeSummary: Record<string, { count: number; total: number; label: string }> = {
      TRANSPORT: { count: 0, total: 0, label: "交通" },
      MEAL: { count: 0, total: 0, label: "餐饮" },
      TRAVEL: { count: 0, total: 0, label: "差旅" },
      OFFICE: { count: 0, total: 0, label: "办公" },
      OTHER: { count: 0, total: 0, label: "其他" },
    };

    let grandTotal = 0;
    for (const e of expenses) {
      const key = e.expenseType;
      if (typeSummary[key]) {
        typeSummary[key].count++;
        typeSummary[key].total += e.amount;
      }
      grandTotal += e.amount;
    }

    return NextResponse.json(
      {
        month,
        expenses: expenses.map((e) => ({
          id: e.id,
          month: e.month,
          expenseType: e.expenseType,
          customType: e.customType,
          amount: e.amount,
          description: e.description,
          createdAt: e.createdAt.toISOString(),
          user: {
            id: e.user.id,
            name: e.user.name,
            email: e.user.email,
            image: e.user.image,
          },
        })),
        summary: {
          total: grandTotal,
          count: expenses.length,
          byType: Object.entries(typeSummary).map(([key, val]) => ({
            type: key,
            label: val.label,
            count: val.count,
            total: Math.round(val.total * 100) / 100,
          })),
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err) {
    console.error("[api/reports/monthly-expenses/stats] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
