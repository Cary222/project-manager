# 月度报销功能 开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + PostgreSQL）
> 目标：让团队新人 / 未来的我能完整复现"月度报销"功能的端到端开发与测试过程。
> 工单：#10196

---

## 1. 目标 & 背景

### 1.1 为什么需要月度报销功能

- 团队成员需要提交月度报销单据，包含报销类型、金额、说明和附件（PDF/图片）
- 管理者需要查看全员报销统计
- 参考周报（WeeklyReport）模式设计，确保与项目现有功能风格一致

### 1.2 核心能力

- **成员**：提交/编辑/删除自己的报销记录，上传 PDF/图片附件
- **全员**：查看当月报销汇总（总金额、各类型占比）
- **权限**：报销详情只能查看/编辑自己的，stats 端点所有人可访问（与周报一致）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | 新增 MonthlyExpense 模型 + ExpenseType/ExpenseStatus 枚举 |
| `app/api/reports/monthly-expenses/route.ts` | 新增 | GET（我的报销列表）+ POST（创建报销） |
| `app/api/reports/monthly-expenses/[id]/route.ts` | 新增 | GET/PATCH/DELETE 单条报销 |
| `app/api/reports/monthly-expenses/stats/route.ts` | 新增 | 全员月度统计端点 |
| `features/reports/monthly-expenses/lib/monthly-expense-store.ts` | 新增 | Store 层：CRUD 操作 |
| `features/reports/monthly-expenses/ui/MonthlyExpenseForm.tsx` | 新增 | 报销表单组件（支持附件） |
| `features/reports/monthly-expenses/ui/MonthlyExpenseList.tsx` | 新增 | 报销列表组件 |
| `features/reports/ui/MonthlyExpenseBoard.tsx` | 新增 | Dashboard 月度报销看板 |
| `features/reports/ui/index.ts` | 修改 | 导出 MonthlyExpenseBoard |
| `app/reports/monthly-expenses/page.tsx` | 新增 | 报销列表页 |
| `app/reports/monthly-expenses/new/page.tsx` | 新增 | 新建报销页 |
| `app/reports/monthly-expenses/[id]/page.tsx` | 新增 | 报销详情页 |
| `app/reports/monthly-expenses/[id]/MonthlyExpenseDetailClient.tsx` | 新增 | 详情页客户端组件 |
| `app/reports/page.tsx` | 修改 | Dashboard 集成 MonthlyExpenseBoard |

---

## 3. 核心实现

### 3.1 数据库模型（`prisma/schema.prisma`）

```766:781:prisma/schema.prisma
enum ExpenseType {
  TRANSPORT  // 交通
  MEAL       // 餐饮
  TRAVEL     // 差旅
  OFFICE     // 办公
  OTHER      // 其他

  @@schema("pm")
}

model MonthlyExpense {
  id           String        @id @default(cuid())
  userId       String
  month        String        // "YYYY-MM" 格式，如 "2026-07"
  expenseType  ExpenseType
  customType   String?       // 当 expenseType = OTHER 时使用
  amount       Float
  description  String
  attachments  Json?        // FileAttachment[]
  status       ExpenseStatus @default(ACTIVE)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, month(sort: Desc)])
  @@index([month(sort: Desc)])
  @@schema("pm")
}
```

**设计说明**：
- 无唯一约束：同一人同月可多次报销同一类型（与周报不同，周报是每周唯一）
- 软删除：status = DELETED 而非物理删除
- attachments 直接复用 FileAttachment[] 类型

### 3.2 Store 层（`features/reports/monthly-expenses/lib/monthly-expense-store.ts`）

```36:52:features/reports/monthly-expenses/lib/monthly-expense-store.ts
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
```

**设计说明**：
- 游标分页：take + 1 判断是否有下一页
- 筛选支持：按月份筛选

### 3.3 API 权限控制（`app/api/reports/monthly-expenses/[id]/route.ts`）

```30:36:app/api/reports/monthly-expenses/[id]/route.ts
  if (!expense || expense.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 只能查看自己的报销
  if (expense.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

**设计说明**：
- GET [id] 必须校验资源所有权，防止越权访问他人报销
- PATCH/DELETE 通过 store 层参数校验（userId 匹配）

### 3.4 全员统计端点（`app/api/reports/monthly-expenses/stats/route.ts`）

```53:70:app/api/reports/monthly-expenses/stats/route.ts
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
```

**设计说明**：
- stats 端点无权限限制（与周报一致），所有人可查全员报销
- 返回报销明细列表 + 按类型汇总

---

## 4. 环境与配置

| 变量 | 值 | 说明 |
|------|-----|------|
| 数据库 | PostgreSQL `pm` schema | 月度报销存储 |
| 文件上传 | `POST /api/upload` | 附件存 FileAsset 表 |
| 端口 | 3003 | Next.js dev server |
| schema push | `npx prisma db push` | 同步数据库 |

---

## 5. 启动 / 部署

```bash
# 1. 同步数据库（必须先执行）
cd /Users/vastgui/Desktop/project-manager
npx prisma db push

# 2. 启动开发服务器
npm run dev

# 3. 确认服务存活
curl http://localhost:3003/api/reports/monthly-expenses
```

---

## 6. 测试 & 验证

### 6.1 数据库同步验证

```bash
# 确认 MonthlyExpense 表已创建
npx prisma db push 2>&1 | grep -E "MonthlyExpense|ExpenseType|ExpenseStatus"
```

**期望输出**：`The migration that just ended moved 3 tables and created 0 tables` 或类似成功信息

### 6.2 API 端点验证

```bash
# 获取我的报销列表（需先登录获取 session cookie）
curl -X GET "http://localhost:3003/api/reports/monthly-expenses?limit=20" \
  -H "Cookie: next-auth.session-token=YOUR_TOKEN"

# 创建报销
curl -X POST "http://localhost:3003/api/reports/monthly-expenses" \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_TOKEN" \
  -d '{
    "month": "2026-07",
    "expenseType": "TRANSPORT",
    "amount": 150.5,
    "description": "出差交通费"
  }'

# 获取全员统计
curl -X GET "http://localhost:3003/api/reports/monthly-expenses/stats?month=2026-07" \
  -H "Cookie: next-auth.session-token=YOUR_TOKEN"
```

**期望输出**：
- GET list: `{"expenses": [...], "nextCursor": null}`
- POST: `{"expense": {"id": "...", "amount": 150.5, ...}}`
- GET stats: `{"month": "2026-07", "expenses": [...], "summary": {"total": 150.5, "byType": [...]}}`

### 6.3 浏览器手测

1. 访问 `/reports` 页面，确认 MonthlyExpenseBoard 看板显示
2. 点击"报销"进入 `/reports/monthly-expenses`
3. 点击"新建报销"进入 `/reports/monthly-expenses/new`
4. 填写表单（选择类型、输入金额、添加附件）
5. 提交后返回列表确认显示
6. 点击查看详情，确认附件可下载

---

## 7. 复现 Checklist

- [ ] `npx prisma db push` 同步数据库
- [ ] 确认 `MonthlyExpense` 表存在于 `pm` schema
- [ ] 启动 `npm run dev`
- [ ] 访问 `/reports` 确认 MonthlyExpenseBoard 看板存在
- [ ] 访问 `/reports/monthly-expenses` 确认列表页正常
- [ ] 访问 `/reports/monthly-expenses/new` 确认表单可填写
- [ ] 创建一条报销记录
- [ ] 上传附件（PDF/图片）
- [ ] 编辑报销记录
- [ ] 删除报销记录（软删除）
- [ ] 访问 `/api/reports/monthly-expenses/stats` 确认统计端点正常
- [ ] 切换月份查看历史报销

---

## 8. 踩坑记录

### 坑 1：GET [id] 未校验资源所有权

**现象**：任何登录用户可以通过 `GET /api/reports/monthly-expenses/[任意id]` 查看他人的报销记录

**原因**：实现时只校验了登录状态，未校验 `expense.userId !== session.user.id`

**解法**：在 GET 处理器中添加资源所有权校验：

```30:36:app/api/reports/monthly-expenses/[id]/route.ts
  if (!expense || expense.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 只能查看自己的报销
  if (expense.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

### 坑 2：唯一约束设计决策

**现象**：最初计划在 `@@unique([userId, month, expenseType])`，导致同一人同月同一类型只能报销一次

**原因**：设计时参考了周报的唯一约束模式，但报销场景不同（可能多次出差）

**解法**：去掉唯一约束，允许同一人同月多次报销同一类型

### 坑 3：stats 端点权限策略

**现象**：审查者建议 stats 端点加 ROOT 权限限制

**原因**：报销金额属于隐私数据，但与周报设计一致（所有人可见全员）

**解法**：保持与周报一致的设计决策（任何人可查全员统计），如有需要可在未来加权限控制

---

## 附录：报销类型枚举

| 值 | 标签 | 说明 |
|----|------|------|
| TRANSPORT | 交通 | 交通费用 |
| MEAL | 餐饮 | 餐饮费用 |
| TRAVEL | 差旅 | 差旅费用 |
| OFFICE | 办公 | 办公用品 |
| OTHER | 其他 | 其他费用（需填写 customType） |
