# PR-Deadline 硬技术审查

**Scope:** PR-Deadline — Ticket 截止日期（deadline）+ OVERDUE/CLOSED 状态 + Cron 扫描
**Review Type:** Local Changes（PR-Deadline 产物）
**Files Reviewed:** 13 个核心文件（见下）

---

## TL;DR

✅ **建议合并，有 1 个 Critical 项需修复。**

tsc 零新增错误（仅预存历史错误）。Prisma schema / migration 结构正确。API 权限控制逻辑严密。`ROOT_ONLY_STATUSES` 正确生效。唯一 Critical 在 `week.ts` 周日边界 case（`offset = -6` 倒退 6 天），影响周日深夜建单时 `computeDefaultDeadline` 返回下下周而非本周周日。

---

## Critical (Must Fix Before Merge)

- [ ] **C-1** `shared/lib/week.ts:36` — `getWeekRange` 周日边界 case

  ```ts:36:36
  const offset = day === 0 ? -6 : 1 - day;
  ```

  当 `reference` 是周日时，`weekStart = reference - 6 days`（上周一），`weekEnd = reference - 1 day`（上周日）。**即周日的截止期被计算为"上周日"，而非"本周日"**。

  影响：`computeDefaultDeadline(new Date("2026-06-28T22:00:00Z"))`（周日深夜）→ `weekEnd = 上上周日`，`msUntilWeekEnd ≈ 13 天` → 返回 weekEnd（错误地延后两周）。

  正确行为：周日深夜建单，应以**本周日 23:59:59 UTC** 为截止期（仅剩 1-2 小时），或顺延一周。

  **建议**：改 `offset = day === 0 ? 0 : 1 - day`（周日起始 = 当天），或明确文档说明"周日内建单顺延一周"。

- [ ] **C-2** `features/ticket/create/action.ts:126` — `action: "CREATE_TICKET" as any` 类型绕过

  ```75:126:features/ticket/create/action.ts
          deadline: input.deadline ? new Date(input.deadline) : null,
          repoBindings: {
            create: (input.repoPaths ?? [])
  ```

  ```126:126:features/ticket/create/action.ts
        action: "CREATE_TICKET" as any,
  ```

  `createModerationLog` 的 `action` 参数类型为 `ModerationAction` enum，`"CREATE_TICKET" as any` 绕过了 TS 类型检查。虽然 Prisma 层会接受此字符串，但与 `app/api/tickets/route.ts:127` 使用的 `ModerationAction.CREATE_TICKET` 不一致。

  **建议**：导入 `ModerationAction` 并用 `action: ModerationAction.CREATE_TICKET`（同 `route.ts` 的做法），移除 `as any`。

---

## Important (Should Fix)

- [ ] **I-1** `shared/lib/cron-scheduler.ts:123-124` — 多实例竞态（运行时开销，非数据损坏）

  ```123:124:shared/lib/cron-scheduler.ts
  if (process.env.NODE_ENV !== "test") {
    startOverdueScanner();
  }
  ```

  `__started` 是模块级变量（单进程内单例）。Next.js 部署多实例时，每个实例独立加载模块，各自启动定时器。数据库操作（`findMany` + 乐观更新）有幂等保护，不会产生重复状态写入，但造成多余扫描开销。

  **建议**：如果项目预期多实例部署，考虑用数据库锁（如 `SELECT FOR UPDATE NOWAIT`）或 Redis 锁保证扫描进程唯一性。当前幂等实现已足够防数据损坏，标记为 Important 而非 Critical。

- [ ] **I-2** `features/ticket/create/action.ts:113-122` — `createManyNotifications` 未 attach `.catch`

  ```113:122:features/ticket/create/action.ts
        void createManyNotifications({
          userIds: assigneeIds,
          type: "TICKET_ASSIGNED",
          title: notification.title,
          content: notification.content,
          ticketId: ticket.id,
          actorId: session.user.id,
        }).catch((error) => {
          console.error("createManyNotifications failed", error);
        });
  ```

  同 `.catch()` 块在 `createTicketAction` 中存在，但 `createBugTicketAction`（第 217-225 行）没有类似的 `.catch()` 保护。如果 `createManyNotifications` 在 bug ticket 创建中 reject，会产生未处理 rejection。

  **建议**：在 `createBugTicketAction` 中补上相同的 `.catch()` 处理（已有 `createModerationLog.catch`，补充 notification 的即可）。

- [ ] **I-3** `features/ticket/create/action.ts:6` — 未使用 import

  ```6:6:features/ticket/create/action.ts
  import {
    assigneeUserSelect,
    normalizeAssigneeIds,
    replaceTicketAssignees,
  } from "@/entities/ticket/lib/ticket-assignees";
  ```

  `assigneeUserSelect` 已导入但未在文件中使用（`normalizeAssigneeIds` 和 `replaceTicketAssignees` 有使用）。应移除未使用项以保持 import 清洁。

---

## Nit (Nice to Have)

- **N-1** `features/ticket/create/CreateTicketForm.tsx:142-154` — `datetime-local` 输入为本地时区

  `type="datetime-local"` 返回用户本地时间字符串（如 `"2026-06-30T10:00"`），而 `new Date(str)` 将其解析为**本地时区的 UTC 时刻**。`computeDefaultDeadline` 用 UTC 计算 `weekEnd`。如果用户时区 ≠ UTC，截止期会有时区偏移。

  建议：明确在 UI 标注"截止日期以 UTC 保存"，或前端统一转为 UTC 字符串再传给后端。

- **N-2** `features/reports/lib/reports-store.ts:129-138` — `getDailyTrend` 中 7 次独立 `count` 调用

  `Promise.all(daysData.map(...))` 对每天各发一次 `ticket.count` + 一次 `ticketStatusHistory.count` = 14 次数据库往返。数据量小可接受，但随 `days` 参数增长会线性增长。

  建议：考虑用单次 `GROUP BY` 聚合查询替代循环 `count`。

- **N-3** `scripts/overdue-scan-test.ts` — `runOverdueScan` 返回值未校验

  测试调用 `const count = await runOverdueScan()` 但从未断言 `count` 的值是否与预期符合（是否扫描到正确的 ticket 数）。当前仅验证 ticket 状态变更是正确的，但未验证扫描覆盖范围。

---

## 通过项（确认无问题）

| 检查项 | 文件 | 结论 |
|--------|------|------|
| `@@index([status, deadline])` 命名一致 | `prisma/schema.prisma:340` + `migration.sql:9` | ✅ 均为 `Ticket_status_deadline_idx` |
| `deadline DateTime?` nullable + 正确类型 | `prisma/schema.prisma:320` | ✅ `DateTime?` |
| `OVERDUE`/`CLOSED` 在 enum 末尾（PG enum 追加顺序） | `prisma/schema.prisma:50-56` | ✅ 新值追加在 DEVELOPING/DELIVERED/DONE 之后 |
| `migration.sql` enum 追加有 `IF NOT EXISTS` 保护 | `prisma/migrations/manual_add_ticket_deadline/migration.sql:13-35` | ✅ 幂等，可安全重跑 |
| `ROOT_ONLY_STATUSES` 仅 root 可写 | `app/api/tickets/[id]/status/route.ts:45-48,122-124` | ✅ 双重检查：`!isRoot && ROOT_ONLY_STATUSES.has(nextStatus)` → 403 |
| 关闭接口 `requireRoot` | `app/api/tickets/[id]/close/route.ts:16` | ✅ |
| 关闭接口防重复关闭（DONE/CLOSED → 400） | `app/api/tickets/[id]/close/route.ts:37-45` | ✅ |
| OVERDUE 状态可被 root 关闭（状态机正确） | `app/api/tickets/[id]/close/route.ts:37-45` | ✅ 仅排除 DONE 和 CLOSED，OVERDUE 可关闭 |
| `deadline` 入库前 `new Date()` 转换 | `app/api/tickets/route.ts:75` + `action.ts:75` | ✅ 统一 `new Date(body.deadline)` |
| `deadline` 非法字符串 → `new Date("invalid")` = Invalid Date → Prisma 报错 | `app/api/tickets/route.ts:75` | ✅ |
| `deadline` 可选（不传/null → null） | `action.ts:75` | ✅ `body.deadline ? new Date(...) : null` |
| `status/route.ts` 对 `id` 的 `Number.isInteger` 容错 | `app/api/tickets/[id]/status/route.ts:73` | ✅ NaN → false → 查询 `id` 字段 |
| `close/route.ts` 同样容错 | `app/api/tickets/[id]/close/route.ts:18-21` | ✅ 同上 |
| `isOverdue` terminal 状态含 CLOSED | `shared/lib/ticket-deadline.ts:42-46` | ✅ |
| `isDeadlineApproaching` terminal 含 OVERDUE | `shared/lib/ticket-deadline.ts:59-64` | ✅ 避免对已逾期单重复提示 |
| `runOverdueScan` 每次扫描全量查询 | `shared/lib/cron-scheduler.ts:32-42` | ✅ 无 N+1（单次 findMany） |
| 扫描内 ticket 逐条事务更新（状态写入 + history） | `shared/lib/cron-scheduler.ts:59-72` | ✅ |
| `rootUser` 找不到时的 fallback `changedById: "system"` | `shared/lib/cron-scheduler.ts:69` | ✅ |
| 扫描异常不阻断其他 ticket | `shared/lib/cron-scheduler.ts:75-77` | ✅ 单条 try/catch |
| cron `findMany` 用 `select` 避免返回大 payload | `shared/lib/cron-scheduler.ts:37-42` | ✅ 仅选 id/ticketNo/title |
| `week.ts` UTC 一致性 | `shared/lib/week.ts` | ✅ 全部用 `Date.UTC` 计算，注释明确 |
| `app/api/projects/[id]/route.ts` GET `select` deadline | `app/api/projects/[id]/route.ts:34` | ✅ |
| `deadline` → `toISOString()` 序列化 | `app/api/projects/[id]/route.ts:70` | ✅ |
| `entities/ticket/model/types.ts` STATUS_LABEL/STYLE/ORDER 完整 | `entities/ticket/model/types.ts:141-172` | ✅ 含 OVERDUE/CLOSED |
| `STATUS_ORDER` 中 CLOSED = 5（最大，终态排序最后） | `entities/ticket/model/types.ts:165-172` | ✅ 正确 |
| `TaskStatsCards` 中无 OVERDUE 统计（仅统计常规状态） | `features/dispatch/ui/DispatchProjectDetail.tsx:272-283` | ✅ |
| Dispatch 关闭按钮仅 root 可见 | `features/dispatch/ui/DispatchProjectDetail.tsx:621-638` | ✅ `isRoot ? ... : null` |
| `closeTicket` 后 `loadProject()` 刷新 UI | `features/dispatch/ui/DispatchProjectDetail.tsx:311-323` | ✅ |
| `deadline` 显示仅对非 CLOSED 单生效 | `features/dispatch/ui/DispatchProjectDetail.tsx:615` | ✅ `ticket.status !== "CLOSED"` |
| Dashboard `STATUS_STYLE` 含 OVERDUE/CLOSED | `features/dashboard/Dashboard.tsx:34-41` | ✅ |
| Dashboard `STATUS_DOT` 含 OVERDUE/CLOSED | `features/dashboard/Dashboard.tsx:43-50` | ✅ |
| TasksBoard 6 列含 OVERDUE + CLOSED | `features/task/TasksBoard.tsx:11-49` | ✅ |
| `getLatestDoneAt` helper 正确 | `features/reports/lib/reports-store.ts:245-252` | ✅ |
| `isDeadlineApproaching` 24h boundary 用 `<=`（含边界） | `shared/lib/ticket-deadline.ts:70` | ✅ |
| 单元测试 14/14 覆盖核心纯函数 | `scripts/ticket-deadline-unit-test.ts` | ✅ |
| 集成测试 7 个场景覆盖状态机 | `scripts/overdue-scan-test.ts` | ✅ |

---

## 测试建议（缺陷覆盖）

| 缺失测试 | 严重度 | 说明 |
|----------|--------|------|
| `close/route.ts` — ROOT 关闭 OVERDUE 单（状态机合法路径） | Should | 当前测试未覆盖 OVERDUE → CLOSED |
| `close/route.ts` — 非 root 调用 → 401/403 | Should | API 权限测试缺失 |
| `week.ts` — 周日 23:00 UTC 边界 case | Should | 对应 C-1 |
| `action.ts` — `deadline` 传入 `"invalid-date"` 字符串 → 400 | Should | 非法入参校验 |
| `action.ts` — `deadline` 传入过去日期 → 允许写入（业务允许"追溯截止期"） | Nice | 需确认业务规则 |
| `runOverdueScan` 并发：两个进程同时扫同一批 OVERDUE 单 | Nice | 确认无重复历史写入 |
| `status/route.ts` — root 写 OVERDUE/CLOSED（非 cron 路径） | Should | 确认权限通路全通 |

---

## 踩坑记录对照

本 PR 为新增功能（无历史复现文档对应坑记录）。确认以下已知风险已正确处理：

| 风险点 | 处理方式 | 状态 |
|--------|----------|------|
| PG enum 追加需事务外执行 | `migration.sql` 用 `DO $$` 块包裹 | ✅ |
| 多实例 cron 重复扫描 | `findMany` + 乐观更新，幂等写入；无锁（见 I-1） | ⚠️ 已知，标记 Important |
| `datetime-local` 时区偏移 | 依赖 JS Date 默认行为（见 N-1） | ⚠️ 已知，标记 Nit |
| `createModerationLog` 类型绕过 | `as any` 存在（见 C-2） | ⚠️ 见 C-2 |

---

## 汇总

| 类别 | 数量 |
|------|------|
| Critical (Must Fix) | 2 |
| Important (Should Fix) | 3 |
| Nit (Nice to Have) | 3 |
| 通过项 | 33+ |

**建议**：修复 C-1（`week.ts` 周日 case）和 C-2（`action.ts as any`）后合并。I-1（多实例）可接受，留待部署时观察。
