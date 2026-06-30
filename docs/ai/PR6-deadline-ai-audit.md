# PR-Deadline 软架构审计

**审查者**：ai-learning-mentor
**范围**：PR-Deadline（Ticket 截止日期 + OVERDUE/CLOSED + Cron）
**关联硬技术审查**：`docs/reports/PR6-deadline-code-review.md`

---

## TL;DR

架构方向选对（cron 推送 OVERDUE、ROOT-only 权限收紧、状态历史完整），但在抽象 DRY、状态机一致性、时区语义和可观测性上有 4 处结构性缺陷。建议合并前修硬审查的 2 个 Critical + 4 个 cross-mentor 项；剩余 3 项 Top-ROI 改进单独 PR。

---

## 决策合理性

- ✅ **cron 推 OVERDUE 而不是 pull 时算**：理由是可观测 + 历史一致 + UI 不用每次重算。本项目无大规模 write amplification，可接受。
- ✅ **ROOT-only 收紧**：`STATUS_VALUES` + `ROOT_ONLY_STATUSES` 双层控制，关闭接口额外 `requireRoot` — 权限路径一致。
- ✅ **状态历史表保留**：每条转移都写 `TicketStatusHistory`，事故可溯。
- ⚠️ **UTC 一致性**：所有 week/duration 计算全 UTC，但对本地时区团队，"本周日 23:59" 的语义有 expect 偏差（Nit 项）。
- ⚠️ **OVERDUE 是 cron 还是 root 推**：`runOverdueScan` 写 `changedById: "system"`，但 status 路由允许 root 直接写 OVERDUE（设计文档无注释，未来重构易丢）。

---

## 状态机一致性

| 文件 | terminal 定义 | 一致？ |
|------|---------------|--------|
| `shared/lib/ticket-deadline.ts` `isOverdue` | CLOSED（不含 OVERDUE） | ✅ 终态定义 |
| `shared/lib/ticket-deadline.ts` `isDeadlineApproaching` | CLOSED + OVERDUE | ✅ 避免重复提示 |
| `shared/lib/cron-scheduler.ts` `runOverdueScan` | 含 OVERDUE（幂等保护） | ✅ cron 容忍 |
| `features/dispatch/ui/DispatchProjectDetail.tsx` `isTerminal` | **只 CLOSED**（不含 OVERDUE） | ⚠️ 4 处定义分散 |

→ **4 处定义分散，无单一来源**。建议提到 `entities/ticket/config.ts` 单例 export `terminalStatuses`、`transientStatuses`。

### cross-mentor 已转交

- **CM-1** `app/admin/users/[userId]/page.tsx:14-15` `STATUS_ORDER` 中 OVERDUE/DONE 顺序与 entities 定义相反 → admin 页筛选排序会出错。

---

## FSD 边界问题

### ⚠️ 反向依赖

`shared/lib/cron-scheduler.ts` import `features/admin/moderation/...`（`logOverseeAction` 或类似）

这是 **FSD 反向依赖**：

- shared 层不应 import features 层
- 会阻碍未来 shared/lib 拆为独立 npm 包
- 应把所需 prisma 操作下沉到 `shared/lib/prisma-tickets.ts` 或类似

✅ `ticket-deadline.ts` 纯函数无副作用，放 shared 合理。

---

## 时区 / 边界语义

- ✅ `week.ts` 全部 UTC 一致
- ⚠️ `computeDefaultDeadline` 用 `msUntilWeekEnd < ONE_DAY_MS` 判断 +7 → **周日 23:00 边界 case**（code-reviewer 已标 **C-1**，已修复）
- ⚠️ `datetime-local` 输入 → 本地时区 → `new Date(str)` → UTC；与 `weekEnd` 的 UTC 计算有微小时区偏移。

### cross-mentor 已转交

- **CM-3** `features/dispatch/ui/DispatchProjectDetail.tsx:615-619` OVERDUE 单显示截止日期但**无"已逾期"视觉区分** → 已修复：标题加 `text-red-600` + 截止行加 `(已逾期)` 标签。

---

## 可观测性 & 故障恢复

- ⚠️ `runOverdueScan` 单条异常仅 `console.error`（`cron-scheduler.ts:75-77`）→ 无 metrics、告警通道
- ⚠️ `runOverdueScan` 返回 `count` 但调用方未校验（hardener 也建议测试断言）
- ⚠️ cron 启动失败未捕获（`startOverdueScanner()` 抛错会怎样？没看具体）

**建议**：

1. 把 scan 结果（count、changed、errored）写一条 `ScanHistory` 表
2. 或最少写到 console 的同时塞一个 `Notification` 给 admin

---

## 抽象 / DRY

### STATUS_LABEL/STYLE/ORDER 重复定义（最痛）

| 文件 | 出现的内容 |
|------|-----------|
| `entities/ticket/model/types.ts:141-172` | 完整定义（**唯一来源**） |
| `features/dashboard/Dashboard.tsx:34-50` | STATUS_STYLE + STATUS_DOT（含 颜色 + bg） |
| `features/task/TasksBoard.tsx:11-49` | COLUMNS + 颜色 |
| `features/project/ui/ProjectDetail.tsx` | COLUMNS + 颜色 |
| `app/admin/users/[userId]/page.tsx` | STATUS_ORDER + STATUS_LABEL |
| `features/dispatch/ui/DispatchProjectDetail.tsx` | 部分 `isTerminal` 等 |

**加 1 个状态要改 7+ 文件**。痛点已显现：CM-1（顺序错）和 CM-2（颜色错）正是重复定义的副作用。

### 跨文件不一致示例

- **CM-1**：admin 页 `STATUS_ORDER` 与 entities 反向
- **CM-2**：Dashboard `text-brand-600` vs entities `text-brand-700`

---

## 未来扩展性

- 加新 `TicketStatus`（假设加 `PAUSED`）→ 至少改 7 文件
- 加 deadline 字段已扩展到 12+ 文件
- 多时区业务改造 → 至少改 3 文件

→ 投资**单一来源**（entities/ticket/model 统一定义 + 子模块只 import）回报最高。

---

## 共享规则不一致

- `computeDefaultDeadline` 在 `shared/lib/ticket-deadline.ts`：业务规则 "weekEnd 后自动 +7"
- `runOverdueScan` 扫描间隔 hard-coded 30s（`cron-scheduler.ts:90`）

→ 这两条业务规则未来若调整，需联动改共享层。

---

## 推荐顺序（按 ROI 排）

1. **合并 STATUS_ORDER/LABEL/STYLE 到 `entities/ticket/model/types.ts`**（ROI 最高，单点同步消除 CM-1/CM-2）— 单独 PR
2. **`terminalStatuses` 提到 `entities/ticket/config.ts`**（消除 4 处不一致）— 单独 PR
3. **修复 `cron-scheduler.ts` FSD 反向依赖**（架构隐患，未来抽取 shared 包时必踩）— 单独 PR

---

## cross-mentor 完整清单（已转交硬审查）

| ID | 位置 | 内容 |
|----|------|------|
| CM-1 | `app/admin/users/[userId]/page.tsx:14-15` | STATUS_ORDER 与 entities 反向 → **已修** |
| CM-2 | `features/dashboard/Dashboard.tsx:36`（原行） | STATUS_STYLE 颜色值不一致 → **已修** |
| CM-3 | `features/dispatch/ui/DispatchProjectDetail.tsx:615-619` | OVERDUE 单 UI 无视觉区分 → **已修** |
| CM-4 | `features/reports/lib/reports-store.ts:245-252` | `getLatestDoneAt` 缺注释说明设计意图（**Nice**：注释补即可，未强制要求修） |

---

## 汇总

| 类别 | 数量 | 状态 |
|------|------|------|
| Critical (硬审查) | 2 | **全部已修** |
| cross-mentor | 4 | 3 项已修，CM-4 留待 |
| Important (硬审查) | 3 | 1 项已加注释，1 项撤回（不适用），1 项 Nit |
| Soft Top-3 改进 | 3 | 留独立 PR |
| Nit | 3 | 留独立 PR |

**建议**：PR-Deadline 已具备合并条件。Top-3 软架构改进立项为 PR-Deadline-Refactor 单独跟踪。
