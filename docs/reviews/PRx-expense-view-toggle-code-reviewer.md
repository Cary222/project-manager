<!-- reviewer: code-reviewer (硬层) -->

## 报销展示形式切换 — 硬层审查

### 文件 verdict

| 文件 | verdict | 说明 |
|---|---|---|
| `stats/route.ts` | WARN | groupBy 参数未校验 |
| `health-summary/route.ts` | FAIL | N+1 查询 |
| `ReportsDashboard.tsx` | PASS | - |
| `MonthlyExpenseBoard.tsx` | PASS | - |

---

## 问题清单

### Critical #1 — N+1 查询（health-summary/route.ts）

**位置**：line 131-144

**问题**：`expenseAgg` 按 userId 分组后，对 `topUser.userId` 逐条调用 `prisma.user.findUnique`（虽然代码只取 `[0]`，但逻辑上是循环结构，扩展到多人时必然 N+1）。

```141:144:app/api/reports/health-summary/route.ts
    const topUserName = topUser
      ? (await prisma.user.findUnique({ where: { id: topUser.userId }, select: { name: true } }))?.name ?? "未知"
      : null;
```

**修复方案**：直接复用 Prisma 的 `include` 或改为 `findMany`：

```typescript
// 在 expenseAgg 查询时一并预加载 topUser 信息（只取前 N 人）
const expenseAgg = await prisma.monthlyExpense.groupBy({
  by: ["userId"],
  where: { month: expenseMonth, status: "ACTIVE" },
  _sum: { amount: true },
  _count: true,
  orderBy: { _sum: { amount: "desc" } },
  take: 5, // 只取 Top 5
});

// 一次性查询这些 user 的 name
const userIds = expenseAgg.map(e => e.userId).filter(Boolean);
const users = await prisma.user.findMany({
  where: { id: { in: userIds as string[] } },
  select: { id: true, name: true },
});
const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
const topUserName = userMap[expenseAgg[0]?.userId ?? ""] ?? "未知";
```

---

### Critical #2 — groupBy 参数未校验（stats/route.ts）

**位置**：line 25

```25:app/api/reports/monthly-expenses/stats/route.ts
    const groupBy = (searchParams.get("groupBy") ?? "type") as "type" | "person";
```

**问题**：`as` 断言不校验值合法性，用户传 `?groupBy=invalid` 不会报错，但后续逻辑 `if (groupBy === "person")` 会静默失效，API 永远返回 `byType` 格式。

**修复方案**：加校验，返回 400：

```typescript
const rawGroupBy = searchParams.get("groupBy") ?? "type";
if (rawGroupBy !== "type" && rawGroupBy !== "person") {
  return NextResponse.json({ error: "groupBy 只能是 type 或 person" }, { status: 400 });
}
const groupBy = rawGroupBy as "type" | "person";
```

---

## 通过项

- ✅ `userId === null` 跳过逻辑（line 77）：正确处理多人共同报销场景
- ✅ `keepPreviousData: true`：切换时保留旧数据，无闪烁
- ✅ `focus-visible` 环：两个 UI 文件切换按钮均已加
- ✅ ROOT 鉴权：health-summary 保持 ROOT only
- ✅ 空数据兜底：两个 UI 均展示空状态
- ✅ `Cache-Control: no-store`：stats API 不缓存
- ✅ 类型定义正确：`ExpenseStatsResponse` / `MonthlyStatsResponse` 均正确定义了 `byPerson`

---

## 总体结论

**RECOMMENDED** — 有 2 个 Critical 需要修复后合并。