import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/shared/db/client";

export const dynamic = "force-dynamic";

/**
 * 获取指定月份的全员报销统计。
 *
 * Query params:
 *   - month: YYYY-MM 格式，如 "2026-07"（默认本月）
 *   - groupBy: "type"（默认）| "person"
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
    const rawGroupBy = searchParams.get("groupBy") ?? "type";
    if (rawGroupBy !== "type" && rawGroupBy !== "person") {
      return NextResponse.json({ error: "groupBy 只能是 type 或 person" }, { status: 400 });
    }
    const groupBy = rawGroupBy as "type" | "person";

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

    // 查询当月所有报销（含分摊记录）
    // shares 包含所有参与者的分摊信息，每条记录的 shareAmount 即该人实际分摊金额
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
        shares: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true } },
          },
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

    // 按人员汇总（复用 shares 数据，每条记录的 shareAmount 即该人实际分摊金额）
    const personMap: Record<string, { userId: string; name: string | null; email: string; image: string | null; count: number; total: number }> = {};

    for (const e of expenses) {
      // 该笔报销的所有参与者（来自 ExpenseShare 表的权威分摊金额）
      const participants = e.shares ?? [];

      for (const sh of participants) {
        if (!personMap[sh.userId]) {
          personMap[sh.userId] = {
            userId: sh.userId,
            name: sh.user?.name ?? null,
            email: sh.user?.email ?? "",
            image: sh.user?.image ?? null,
            count: 0,
            total: 0,
          };
        }
        personMap[sh.userId].count++;
        personMap[sh.userId].total += Math.round(sh.shareAmount * 100) / 100;
      }
    }

    const byPerson = Object.values(personMap).sort((a, b) => b.total - a.total);

    const responseData: {
      month: string;
      expenses: ReturnType<typeof expenses.map>;
      summary: {
        total: number;
        count: number;
        byType: { type: string; label: string; count: number; total: number }[];
        byPerson?: { userId: string; name: string | null; email: string; image: string | null; count: number; total: number }[];
      };
    } = {
      month,
      expenses: expenses.map((e) => ({
        id: e.id,
        userId: e.userId,
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
        shares: e.shares?.map((sh) => ({
          id: sh.id,
          userId: sh.userId,
          shareAmount: sh.shareAmount,
          user: {
            id: sh.user.id,
            name: sh.user.name,
            email: sh.user.email,
            image: sh.user.image,
          },
        })),
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
    };

    if (groupBy === "person") {
      responseData.summary.byPerson = byPerson;
    }

    return NextResponse.json(
      responseData,
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
