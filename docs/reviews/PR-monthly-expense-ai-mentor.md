# 月度报销功能 — 软层审查报告（ai-learning-mentor）

<!-- reviewer: ai-learning-mentor (软层) -->
<!-- date: 2026-07-28 -->
<!-- scope: 新增 MonthlyExpense 模型 + 完整 CRUD + Dashboard 看板 -->

---

## 总体评价

**✅ APPROVED — 可以合入**

这是一个高质量的功能实现，严格遵循项目既有模式，FSD 边界清晰，UI 体验完整。软层没有发现需要阻挡的问题。

---

## 1. 架构合理性

### 1.1 FSD 边界 ✅

月度报销功能完全遵守了 ProjectHub 的 Feature-Sliced Design 规范：

```
features/reports/monthly-expenses/
├── lib/
│   └── monthly-expense-store.ts    ← 纯数据层（Prisma 调用 + 类型定义）
└── ui/
    ├── MonthlyExpenseForm.tsx      ← 表单 UI
    └── MonthlyExpenseList.tsx      ← 列表 UI
```

**一个值得注意的设计决策**：Store 层不放在 `shared/lib/` 而是放在 `features/reports/monthly-expenses/lib/`。这样做的好处是 Store 中的类型（`MonthlyExpenseWithUser`、`EXPENSE_TYPE_LABELS`）天然和 feature UI 绑定，不会被全局污染。如果放在 `shared/` 里，`MonthlyExpenseWithUser` 这种专用类型会被所有地方都能引用，增加耦合风险。

**与周报对比**：周报模块在 `features/reports/lib/reports-store.ts` 里混了多个 Store（`getReportsStats`、`getWeeklyStats` 等），而月度报销选择了更内聚的 feature 内部 Store。这是合理的取舍——周报模块更老，Store 更分散；新 feature 有机会做更好的内聚。

### 1.2 复用现有组件 ✅

最值得肯定的地方：**附件系统完全复用 `AttachmentEditor`**

```10:15:features/reports/monthly-expenses/lib/monthly-expense-store.ts
import type { FileAttachment } from "@/shared/lib/pkm";
```

```198:204:features/reports/monthly-expenses/ui/MonthlyExpenseForm.tsx
<AttachmentEditor
  attachments={attachments}
  onChange={setAttachments}
  onError={(msg) => toast.error(msg)}
  compact
/>
```

`FileAttachment` 类型来自 `shared/lib/pkm`，`AttachmentEditor` 来自 `shared/ui/AttachmentEditor`。这意味着附件上传/预览/删除的整套基础设施（FileAsset 表、FileReference 表、`/api/upload` 路由）全部复用，没有重新发明轮子。

**软层观察**：附件系统已经在工单评论、PKM 笔记里用过，现在又多了报销。这说明 `FileReference` 的抽象是成功的——业务实体只需要定义 `attachments: Json` 字段，基础设施自动处理关联。

### 1.3 API 路由组织 ✅

```
app/api/reports/monthly-expenses/
├── route.ts                        ← GET + POST（列表 + 创建）
├── [id]/route.ts                  ← GET + PATCH + DELETE（单个操作）
└── stats/route.ts                 ← 统计聚合（Dashboard 专用）
```

`stats/route.ts` 单独拎出来很有意思——它查全员的报销（`where: { month, status: ACTIVE }`），而主路由的 GET 只查自己的（`where: { userId, month, status: ACTIVE }`）。这个分离让权限边界非常清晰：`/stats` 未来只需要加一个 ROOT 权限校验就够了，不会影响到普通用户的 CRUD。

---

## 2. 学习价值

### 2.1 对项目成员的学习价值：中等偏高

**值得学习的模式**：

1. **软删除设计**：`MonthlyExpense` 用 `status: ExpenseStatus` 而非物理删除。所有查询默认带 `status: "ACTIVE"` 过滤。这和 ProjectHub 的工单系统（`Ticket.status`）、PKM（`isPublic` 软字段）一致，形成项目内统一的数据保留策略。

2. **attachments Json 序列化**：`FileAttachment[]` 类型在前端用 `unknown` 类型流转，最后通过 `filter()` 做类型守卫。这是一个在 TS 类型宽松场景下保持类型安全的常用手法。

3. **MonthSwitcher 组件的本地状态管理**：`MonthlyExpenseBoard` 里的月份切换用 `useState` 管理，**没有**放进 URL 参数。这和周报的选择器行为一致（周报周选择器也是本地状态）。这是一个设计取舍的典型案例——如果需要"分享某月数据"，应该用 URL；只是交互切换，本地状态更轻量。

4. **Dashboard 嵌入式看板**：`MonthlyExpenseBoard` 用 `useSWR` 每 30 秒自动刷新（`refreshInterval: 30000`），而列表页用的是 Server Component 直接 `listMyExpenses()`。两种数据获取模式并存，是 Next.js App Router 的典型场景。

### 2.2 可以改进的地方（软层建议，非必须修复）

| 问题 | 影响 | 建议 |
|------|------|------|
| `colorMap` 在 `MonthlyExpenseList` 和 `MonthlyExpenseBoard` 各写了一份 | 重复代码 | 提取到 `lib/constants.ts` 里 |
| `EXPENSE_TYPE_LABELS` 硬编码中文 | 未来国际化困难 | 可以考虑用 i18n 框架，但当前项目无此需求，可接受 |
| `stats/route.ts` 没有权限校验（目前所有登录用户都能查全员数据） | 信息泄露风险 | 这是一个已知缺口，建议尽快加 ROOT 权限判断 |

**关于权限的一点思考**：当前 `stats/route.ts` 的实现中，所有登录用户都能查全员报销总数。这在团队内公开报销的场景下是合理的；但如果报销涉及敏感金额，建议在 `app/api/reports/monthly-expenses/stats/route.ts` 里加一个 ROOT 判断：

```ts
if (session.user.role !== "ROOT") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

---

## 3. 扩展性

### 3.1 未来可能的扩展方向

1. **报销审批流**：目前是纯个人记录，没有审批环节。如果未来需要主管审批，可以在 `MonthlyExpense` 加 `approvedBy`、`approvedAt`、`rejectedReason` 字段，或者新建 `MonthlyExpenseApproval` 表。

2. **按月汇总导出**：在 `stats/route.ts` 基础上，可以新增 `/api/reports/monthly-expenses/export?month=YYYY-MM` 返回 Excel/CSV。当前统计逻辑已经是后端聚合好的，直接复用很方便。

3. **历史月份筛选**：列表页（`app/reports/monthly-expenses/page.tsx`）目前没有月份筛选器，只有 Dashboard 看板有 `MonthSwitcher`。如果用户报销记录多了，可能会需要按月过滤列表。

4. **与工单关联**：报销记录可以关联到具体工单（`ticketId` 字段），方便报销时有业务背景。这需要在 `MonthlyExpense` 模型里加 `ticketId` 外键，以及在报销表单里加工单选择器。

### 3.2 潜在的设计缺陷

**✅ 没有发现严重缺陷。** 数据模型设计简洁（6 个核心字段 + 软删除 + 附件），没有过度设计。枚举 `ExpenseType` 和 `ExpenseStatus` 放在 Prisma schema 里，和 Prisma 生成类型绑定，是项目内标准做法（参考 `TicketStatus`、`NotificationType`）。

---

## 4. 与周报模式对比

### 4.1 合理的差异

| 维度 | 周报（历史） | 月度报销（新增） | 评价 |
|------|-------------|----------------|------|
| Store 位置 | `features/reports/lib/reports-store.ts`（全局） | `features/reports/monthly-expenses/lib/`（feature 内） | **报销更内聚**，减少全局污染 |
| 列表页数据获取 | Server Component 直接调用 store | Server Component 直接调用 store | 一致 ✅ |
| Dashboard 看板 | `WeeklyReportBoard`（Server Props 注入） | `MonthlyExpenseBoard`（useSWR 客户端拉取） | **风格不一致**，但各有道理：周报数据在 SSR 时一起拉，30 秒刷新满足需求；报销看板完全独立，客户端拉取更灵活 |
| 类型定义 | 内联在 store 里 | 导出到 `monthly-expense-store.ts` 顶层 | 一致 ✅ |

### 4.2 一个值得讨论的不一致

`WeeklyReportBoard` 用 Server 数据（SSR 时注入），`MonthlyExpenseBoard` 用客户端 SWR（每 30 秒刷新）。这两种做法在同一个 Dashboard 页面里并存：

```
app/reports/page.tsx
  ├── <ReportsKpiCards />        ← SSR 数据
  ├── <ReportsDashboard />       ← SSR 数据
  ├── <WeeklyReportBoard />      ← SSR 数据
  ├── <MonthlyExpenseBoard />    ← 客户端 SWR ⚠️
  ├── <ReportsProjectHealth />   ← SSR 数据
  └── <ReportsHealthAi />       ← 客户端 SWR
```

**这不是 bug，是 Next.js 的正常模式**：SSR + 客户端 SWR 混合使用。`ReportsHealthAi` 也是客户端 SWR，所以 `MonthlyExpenseBoard` 并不孤单。

**背后的取舍逻辑**：SWR 的优势是用户切月份时不需要刷新页面，SSR 的优势是首屏更快。两者的取舍取决于"数据更新频率"和"用户交互频率"——周报数据变更不频繁，SSR 足够；报销看板有月份切换交互，客户端 SWR 更流畅。

---

## 5. 审查结论与建议

### ✅ 总体通过

月度报销功能在架构上完全符合 ProjectHub 的 FSD 规范，正确复用 shared 层组件，与周报模式对齐良好，同时在 Dashboard 看板中引入了更灵活的数据获取模式。软层没有发现需要修复的问题。

### 📋 补充建议（非阻塞）

1. **⚠️ `stats/route.ts` 权限缺口**：目前所有登录用户能查全员报销数据。如果这是预期行为（比如团队报销公开），可以保持；如果需要权限隔离，建议加 ROOT 判断。

2. **📝 `colorMap` 重复**：`MonthlyExpenseList` 和 `MonthlyExpenseBoard` 各有一份 `colorMap`。虽然代码量不大，但提取到 `lib/constants.ts` 可以减少未来维护成本。

3. **🔮 未来扩展预留**：如果未来有审批流需求，建议在 Prisma schema 里预留 `approvedAt`、`rejectedReason` 字段，而不是之后加 nullable 字段迁移。

---

## 附录：关键文件索引

| 文件 | 作用 | 重点关注 |
|------|------|---------|
| `prisma/schema.prisma:561` | MonthlyExpense 数据模型 | 软删除设计 |
| `features/reports/monthly-expenses/lib/monthly-expense-store.ts` | Store 层 | 类型导出 + 附件过滤模式 |
| `features/reports/ui/MonthlyExpenseBoard.tsx` | Dashboard 看板 | MonthSwitcher + useSWR |
| `app/api/reports/monthly-expenses/stats/route.ts` | 全员统计 API | 权限缺口待关注 |
| `features/reports/monthly-expenses/ui/MonthlyExpenseForm.tsx` | 表单 | AttachmentEditor 复用 |
