# Code Review — 月度报销功能（硬层）

<!-- reviewer: code-reviewer (硬层) -->

**Scope:** PR 月度报销功能涉及的所有新增/修改文件
**Review Type:** Local Changes（未合并 PR）
**tsc 状态:** ✅ 新增代码无类型错误（历史遗留错误与本次 PR 无关，见 `tsc --noEmit` 输出）

---

## Verdict: ⚠️ CHANGES_REQUIRED

发现 **2 个 Critical 安全问题**必须修复，另有若干改进建议。

---

## Critical (Must Fix)

### 1. **[app/api/reports/monthly-expenses/[id]/route.ts:30]** 缺少资源所有权校验（隐私泄露）

```ts
const expense = await getExpenseById(id);
// ❌ 只检查了 status，未校验 expense.userId === session.user.id
if (!expense || expense.status !== "ACTIVE") {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

**Impact:** 任何已登录用户只需知道报销记录的 `id`，即可通过 `GET /api/reports/monthly-expenses/[id]` 查看他人的报销详情（金额、描述、附件），造成隐私泄露。

**Suggestion:**
```ts
if (!expense || expense.status !== "ACTIVE" || expense.userId !== session.user.id) {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

---

### 2. **[app/api/reports/monthly-expenses/stats/route.ts:16-18]** 权限校验不足（组织敏感信息泄露）

```ts
const session = await auth();
if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
// ❌ 仅验证了 session 存在，未检查 ROOT 角色
// 任何已登录用户都能查询全员所有人的报销数据
```

**Impact:** 任意已登录用户可查询任意月份所有用户的报销总额、类型分布和详细记录。这暴露了组织内部的财务行为模式，属于组织级敏感信息。

**Suggestion:**
```ts
// 方案 A（严格）: 仅 ROOT 可访问
if (session?.user?.role !== "ROOT") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// 方案 B（宽松）: 所有已登录用户可查看，但排除敏感的 description 字段
// 详见改进建议 #3
```

---

## Improvements (Recommended)

### 3. **[app/api/reports/monthly-expenses/stats/route.ts]** 返回 payload 过大 — 按需脱敏

当前实现返回了所有报销的完整详情（包括 `description`），但 Dashboard 看板实际只使用 `summary`。

**Reason:** 减少网络传输、提升响应速度；最小化暴露给前端的数据范围。

**Suggestion:** stats API 作为 Dashboard 聚合端，可只返回 `byType` 汇总数据，或在字段级别脱敏（description 不暴露给普通用户）：

```ts
return NextResponse.json({
  month,
  expenses: expenses.map((e) => ({
    id: e.id,
    amount: e.amount,
    expenseType: e.expenseType,
    user: { id: e.user.id, name: e.user.name }, // 移除 email/image
  })),
  summary: { /* ... */ },
});
```

> cross-mentor: stats API 的权限策略（谁能看到谁的数据）属于业务层决策，建议 mentor 给出建议。

---

### 4. **[app/api/reports/monthly-expenses/[id]/route.ts]** PATCH 缺少 403 场景处理

当 `updateExpense` 返回 `NOT_FOUND`（对应"资源不存在或无权访问"）时，统一返回 404。但严格来说：
- 资源存在但不属于当前用户 → 应返回 **403 Forbidden**（而不是 404）
- 资源不存在 → 返回 404

当前错误映射：

```ts
// ❌ 统一返回 404，掩盖了权限不足的情况
if (error instanceof Error && error.message === "NOT_FOUND") {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

**Reason:** 404 掩盖了权限问题，调试时难以区分"资源不存在"和"无权访问"。

**Suggestion:**
```ts
// 在 monthly-expense-store.ts 中区分错误类型
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

// store 层
export async function updateExpense(id: string, userId: string, ...) {
  const existing = await prisma.monthlyExpense.findFirst({ where: { id, userId, status: "ACTIVE" } });
  if (!existing) throw new NotFoundError("Expense not found or not owned by user");
  // ...
}
```

---

### 5. **[features/reports/monthly-expenses/lib/monthly-expense-store.ts]** `ExpenseType` 类型重复定义

```ts
// ❌ Prisma schema 已定义 enum ExpenseType
// 这里又用 string literal union 重新定义了一次
export type ExpenseType = "TRANSPORT" | "MEAL" | "TRAVEL" | "OFFICE" | "OTHER";
```

**Reason:** 两处定义必须保持同步，增加维护负担；且 store 中的 `amount` 等字段用了 `number` 而非 `string`，但 UI 层用 HTML `type="number"` input 时 value 是字符串，需小心处理。

**Suggestion:** 统一从 Prisma Client 导入 enum，或统一用 string literal union 并确保与 schema.prisma 同步。

---

### 6. **[features/reports/monthly-expenses/lib/monthly-expense-store.ts:49]** cursor 分页边界条件

```ts
return opts?.cursor ? expenses.slice(0, -1) as MonthlyExpenseWithUser[] : expenses as MonthlyExpenseWithUser[];
```

**Reason:** 当 `opts?.cursor` 为 truthy 但已到最后一页（即实际返回数量 `< limit`）时，`expenses.slice(0, -1)` 会错误地丢弃最后一条记录。当前逻辑假设"有 cursor 就必定还有下一页"，但 cursor 是上次请求末尾元素的 id，不一定代表还有下一页。

**Suggestion:**
```ts
const hasMore = expenses.length > (opts?.limit ?? 20);
const result = hasMore ? expenses.slice(0, -1) : expenses;
return result as MonthlyExpenseWithUser[];
```

---

### 7. **[app/api/reports/monthly-expenses/route.ts:11-12]** `month` 格式校验不够严格

正则 `/^\d{4}-\d{2}$/` 只验证"4位-2位数字"，不验证月份是否在 01-12 范围内。例如 `2026-99` 会通过校验。

**Reason:** Prisma 会正常存储，但数据不合理；前端 `type="month"` input 会限制合法值，但 API 层也应做防御。

**Suggestion:**
```ts
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
month: z.string().regex(MONTH_REGEX, "月份格式错误，应为 YYYY-MM 且月份在 01-12"),
```

---

### 8. **[features/reports/monthly-expenses/ui/MonthlyExpenseForm.tsx:54]** 金额验证与 schema 不一致

前端验证 `amountNum <= 0`（严格大于 0），但 Zod schema 用 `z.number().positive()`，两者语义一致。但 Zod 的 `positive()` 报错消息是英文，前端是中文，体验不一致。

**Reason:** 无严重问题，但影响用户体验（API 返回的 400 错误消息是英文）。

---

### 9. **[features/reports/monthly-expenses/lib/monthly-expense-store.ts:75-79]** attachments 过滤条件宽松

```ts
attachments = (input.attachments as FileAttachment[]).filter(
  (a): a is FileAttachment => typeof a === "object" && a !== null && "fileId" in a && typeof a.fileId === "string",
);
```

**Reason:** 仅验证 `fileId` 存在且为 string，不验证其他字段（`name`、`mimeType`、`size`）类型。若前端传了错误结构，静默忽略而非报错。

**Suggestion:** 考虑用 Zod 在 store 层验证 attachments 数组，或至少在 API 层对 attachments 做类型守卫失败时的错误处理。

---

## Nitpicks (Optional)

### N1. **[features/reports/ui/MonthlyExpenseBoard.tsx:84]** `canGoNext` 逻辑

```ts
const canGoNext = month < currentMonth;
```

当 `month` 等于当前月份时 `canGoNext = false`，逻辑正确。但若 `month` 来自 URL 手动输入超出当前月份的情况，UI 允许进入"未来月"，这是合理的（允许补报）。

### N2. **[features/reports/ui/MonthlyExpenseBoard.tsx:172-174]** 加载提示条件

```ts
{isLoading && month !== currentMonth && (
  <span className="text-[10px] text-ink-400">加载中…</span>
)}
```

当前月份不显示加载状态，但切换历史月时才会显示。这是合理的设计（当前月数据变更频率低）。

### N3. **[app/reports/page.tsx:69-72]** Dashboard grid 布局

```tsx
<div className="grid gap-5 lg:grid-cols-2">
  <MonthlyExpenseBoard />
</div>
```

月度报销看板独占一行（另一列空），而其他 Dashboard 组件是成对排列。若 `MonthlyExpenseBoard` 设计为跨两列（`lg:col-span-2`）可能更协调。但这属于 UI 布局决策，非功能缺陷。

---

## Positive Points

- ✅ 数据模型设计合理，`ExpenseType` / `ExpenseStatus` enum 与 Prisma schema 保持一致
- ✅ 软删除设计（`status: DELETED` 而非物理删除），保留数据审计能力
- ✅ Prisma schema 索引设计恰当（`[userId, month]` 复合索引覆盖主要查询路径）
- ✅ 所有 API 路由都有 `auth()` 鉴权，没有裸接口
- ✅ Zod schema 与前端 validate 逻辑保持一致
- ✅ `updateExpense` 正确处理了 `customType` 与 `expenseType === "OTHER"` 的联动逻辑
- ✅ 前端表单有 `maxLength` 限制（`description: 500`，`customType: 50`），与用户输入约束匹配
- ✅ 错误处理完整：Zod 校验错误、NOT_FOUND、业务逻辑错误都有区分处理
- ✅ `stats/route.ts` 设置了 `Cache-Control: no-store`，避免陈旧数据
- ✅ `MonthlyExpenseBoard` 使用 SWR `refreshInterval: 30000` 自动轮询，数据新鲜度好
- ✅ 代码复用良好：`EXPENSE_TYPE_LABELS` 常量在多个组件间共享
- ✅ Dashboard 集成自然，`app/reports/page.tsx` 改动简洁

---

## Summary Table

| 维度 | 评级 | 说明 |
|------|------|------|
| **Correctness** | ⚠️ | Critical: GET [id] 缺少所有权校验 |
| **Security** | ❌ | Critical: stats API 无权限控制；GET [id] 可越权查看 |
| **N+1 / Performance** | ✅ | 查询简洁，无 N+1；stats 可考虑只返回汇总减少 payload |
| **Type Safety** | ✅ | 新增代码无 tsc 错误；类型设计合理 |
| **Edge Cases** | ✅ | 空状态、软删除、cursor 分页都有处理 |
| **Testing** | — | 未发现测试文件（建议补充） |

---

## Next Steps

1. **立即修复**：修复 Critical #1（GET [id] 所有权校验）和 Critical #2（stats API 权限）
2. **建议修复**：改进建议 #4（区分 403/404）、#6（cursor 分页逻辑）
3. **可选优化**：改进建议 #3（stats API 脱敏）、#5（类型去重）、#7（月份正则）
4. **确认决策**（cross-mentor）：stats API 的权限策略属于业务层决策
