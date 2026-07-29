# 月度报销查看与编辑权限

## 目标 & 背景

本次迭代解决两个问题：

1. **无法查看他人报销详情**：点击他人的报销单后，跳转详情页但被重定向回列表页（表现为"跳到自己的报销"）。参考周报（`/team/[id]/reports`）的已有实现，照搬到月报。
2. **他人报销详情页仍有编辑按钮**：ROOT 角色查看他人报销单时，附件删除按钮仍然显示。需要区分 `isCreator`（创建者）和 `canEdit`（创建者或 ROOT 可编辑）。

## 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `app/reports/monthly-expenses/[id]/page.tsx` | 修改 | 详情页两次查询（先查自己的 → 找不到查他人的）；传 `canEdit` 给 Client |
| `app/reports/monthly-expenses/[id]/MonthlyExpenseDetailClient.tsx` | 修改 | 用 `canEdit` 控制编辑/删除按钮和附件上传组件 |
| `features/reports/monthly-expenses/lib/monthly-expense-store.ts` | 修改 | 新增 `getMyExpenseById(id, userId)` 和 `listUserExpenses(userId)` |
| `features/team/ui/ProfileHeader.tsx` | 修改 | 报销按钮 href 从 `/reports/monthly-expenses` 改为 `/team/${userId}/expenses` |
| `features/team/ui/UserExpenseList.tsx` | 新增 | 他人报销列表组件（无删除按钮，只读） |
| `app/team/[id]/expenses/page.tsx` | 新增 | 团队成员报销路由页，对齐周报 `/team/[id]/reports` |

## 核心实现

### 1. 详情页两次查询（对齐周报）

```typescript:app/reports/monthly-expenses/[id]/page.tsx
// 优先查询当前用户的报销（可编辑）
let expense = await getMyExpenseById(id, session.user.id);
let isCreator = true;

// 如果不是当前用户的报销，则只读查询
if (!expense) {
  expense = await getExpenseById(id);
  isCreator = false;
}

// 创建者可编辑；ROOT 也可编辑他人报销
const canEdit = isCreator || session.user.role === "ROOT";
```

**back 链接策略**：
- 查看自己报销 → back 回 `/reports/monthly-expenses`
- 查看他人报销 → back 回 `/team/${expense.userId}`

### 2. 详情页 Client 权限控制

```typescript:app/reports/monthly-expenses/[id]/MonthlyExpenseDetailClient.tsx
export function MonthlyExpenseDetailClient({ expense, isCreator = false, canEdit = false }) {
  // canEdit 控制：编辑按钮、删除按钮、附件上传
  // 只读时用 AttachmentItem 而非 AttachmentEditor
}
```

附件区块逻辑：

```typescript
canEdit ? (
  // 编辑模式：AttachmentEditor + onChange
) : (
  // 只读模式：AttachmentItem（无删除按钮）
)
```

### 3. 团队成员报销列表 `/team/[id]/expenses`

对齐周报结构：

```
周报: /team/[id]/reports      → UserWeeklyReportList
月报: /team/[id]/expenses     → UserExpenseList（新建）
```

`UserExpenseList` 无删除按钮，只有"查看"入口指向详情页。

### 4. ProfileHeader 报销按钮修正

```typescript:features/team/ui/ProfileHeader.tsx
// 修复前：硬编码 /reports/monthly-expenses（始终跳自己）
<StatItem label="报销" href="/reports/monthly-expenses" />

// 修复后：指向 /team/${userId}/expenses（自己的 → 自己列表，他人的 → 他人列表）
<StatItem label="报销" href={`/team/${userId}/expenses`} />
```

## 验证步骤

```bash
# 1. 启动服务
npm run dev

# 2. 登录，进入 Dashboard，点击"月度报销"展开列表

# 3. 点击他人的报销单"查看"
#    预期：进入 /reports/monthly-expenses/[id]，back 链接为"返回个人主页"

# 4. 用 ROOT 账号登录，查看非自己的报销单
#    预期：显示"编辑"和"删除"按钮，附件有删除按钮

# 5. 用普通 USER 账号查看他人报销单
#    预期：无编辑/删除按钮，附件只读

# 6. 点击个人主页"报销"按钮
#    预期：跳转 /team/[userId]/expenses，显示自己的报销列表
```

## 关联 PR / Commit

- `#10196` feat(reports): 工作台月度报销入口
- `#10196` fix(reports): 支持查看他人报销详情 + ROOT 编辑权限

---

# 月度报销看板 UI 重构

## 目标 & 背景

本次重构解决 Dashboard 中月度报销模块的两个问题：

1. **按类型/按人员 tab 切换**：用户反馈报销类型分布和人员分布两块信息同时存在 UI 上显得拥挤，交互不够直观。
2. **报销类型分布信息冗余**：只展示各类型金额但没有"提交人是否报销"这种团队可见性信息，对管理者价值不大。
3. **人员展示缺失**：参考周报板块，已提交/未提交的人员一目了然；月报模块没有对应的人员报销情况展示。

改版方向：**移除 tab 切换 + 类型分布，改为展示"本月已报销人员"单区块**，对齐周报 UX 范式。

## 改动清单

| 文件 | 作用 |
|------|------|
| `features/reports/ui/MonthlyExpenseBoard.tsx` | 月度报销主看板组件，移除 tab + 类型分布，新增报销人员展示 |
| `app/api/reports/monthly-expenses/stats/route.ts` | stats API，新增 `groupBy=person` 参数，返回按人员汇总的 byPerson 字段 |
| `features/team/ui/ProfileHeader.tsx` | 修复 skills map 缺少 key 的 React warning |
| `scripts/reports/fix-expense-shares.ts` | 临时修复脚本（已不相关） |

## 核心实现

### 1. API 支持 groupBy=person

```typescript
// app/api/reports/monthly-expenses/stats/route.ts
export async function GET(request: NextRequest) {
  const rawGroupBy = searchParams.get("groupBy") ?? "type";
  // groupBy = person 时，返回 byPerson 数组（按总金额倒序）
  if (groupBy === "person") {
    responseData.summary.byPerson = byPerson;
  }
}
```

**byPerson 数据结构**（来自 `ExpenseShare` 分摊表，不依赖报销人字段）：

```typescript
{
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  count: number;      // 参与了几笔报销
  total: number;     // 该人分摊总金额
}[]
```

### 2. 前端组件改为单区块展示

```tsx
// MonthlyExpenseBoard.tsx
const { data, isLoading } = useSWR<MonthlyStatsResponse>(
  `/api/reports/monthly-expenses/stats?month=${month}&groupBy=person`,
  fetchJson,
  { refreshInterval: 30000, keepPreviousData: true },
);

// 报销人员区块
{byPerson.length > 0 && (
  <div className="mt-4 border-t border-ink-100 pt-4">
    <p className="mb-2 text-xs text-ink-500">报销人员 ({byPerson.length})</p>
    <div className="flex flex-wrap gap-2">
      {byPerson.map((p) => (
        <Link key={p.userId} href={`/team/${p.userId}`} className="...">
          <PersonAvatar src={p.image} name={p.name} email={p.email} />
          <span>{p.name ?? p.email.split("@")[0]}</span>
          <span>{p.count}笔</span>
        </Link>
      ))}
    </div>
  </div>
)}
```

**与周报板块的对照**：周报展示"已提交/未提交"双区块，月报只展示"已报销人员"单区块（因为没有"未报销"的概念——报销是主动行为，不像周报有被动催交逻辑）。

### 3. ProfileHeader skills key 修复

```tsx
// 修复前
{profile.skills.map((s) => (
  <span className="...">{s.kind}</span>  // ❌ 缺少 key
))}

// 修复后
{profile.skills.map((s) => (
  <span key={s.kind} className="...">{s.kind}</span>  // ✅
))}
```

### 4. 详情页跳转 bug 修复

**问题**：Dashboard 月度报销列表展开后，点击他人报销单的"查看"按钮，跳转到 `/reports/monthly-expenses/${id}` 后被重定向到列表页，表现为"跳到自己的报销列表"。

**根因**：`stats` API 最初返回的 `expenses` 数组缺少 `userId` 和 `shares` 字段，导致 `MonthlyExpenseList` 无法正确传递分摊用户数据。详情页 `page.tsx` 的权限检查依赖 `shares` 做 `isShared` 判断，数据缺失时判断失败，302 重定向到列表页。

**修复**：在 `stats/route.ts` 的 expenses 映射中补全 `userId` 和 `shares` 字段：

```typescript
// app/api/reports/monthly-expenses/stats/route.ts
expenses: expenses.map((e) => ({
  id: e.id,
  userId: e.userId,          // 补：报销创建者 ID
  // ...其他字段
  shares: e.shares?.map((sh) => ({
    id: sh.id,
    userId: sh.userId,
    shareAmount: sh.shareAmount,
    user: { /* ... */ },
  })),                        // 补：分摊关联
})),
```

同时同步更新 `MonthlyExpenseBoard.tsx` 中的 `MonthlyStatsResponse` 类型。

## 环境 & 配置

- 端口：本地 3003
- 数据库：PostgreSQL `pm` schema，`MonthlyExpense` + `ExpenseShare` 表
- 无新增环境变量
- 无新增依赖

## 验证步骤

### 本地验证

```bash
# 1. 启动服务
npm run dev

# 2. 访问 Dashboard，确认月度报销模块：
#    - 不再有"按类型/按人员"tab
#    - 类型分布区块消失
#    - 出现"报销人员"单区块（每人显示头像+姓名+笔数）

# 3. 切换月份，确认数据正确刷新

# 4. 打开个人页面 /team/[id]，确认 console 无 React key warning
```

### API 验证

```bash
# 按类型（默认）
curl "http://localhost:3003/api/reports/monthly-expenses/stats?month=2026-07"

# 按人员
curl "http://localhost:3003/api/reports/monthly-expenses/stats?month=2026-07&groupBy=person"
```

预期：`groupBy=person` 时 `summary.byPerson` 字段有数据，`groupBy=type`（默认）时无此字段。

## 关键设计决策

### 为什么 byPerson 金额来自 ExpenseShare 而非 MonthlyExpense.user？

报销单由一人创建，但费用由多人分摊。分摊金额（`shareAmount`）才是每个人真正需要出的钱，因此按 `ExpenseShare` 聚合比按报销人更准确。

### 为什么月报不需要"未报销人员"区块？

周报有催交通知逻辑，团队成员可分为"已提交/未提交"两类。月报没有被动催促机制，所有人都是"已报销"或"未创建报销单"，后者无法从系统数据中可靠判断（不能区分"真的没报销"和"还没填"）。因此只展示实际已报销的人员。

## 关联 PR / Commit

- `#10196` feat(reports): 工作台月度报销入口
