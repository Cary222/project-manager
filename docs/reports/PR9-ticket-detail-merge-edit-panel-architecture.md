# 复盘: TicketDetail 合并编辑改造 (PR9)

**审查范围:** `app/api/tickets/[id]/route.ts` (PATCH) + `features/ticket/ui/ticket-detail/TicketDetail.tsx`
**审查视角:** 软架构层

---

## Verdict: 整体评价

可以合并,但有两个需要正视的架构债务。

这次改造的核心价值是"把 4 个子路由的操作合并到一次 PATCH 请求",用户只需一次编辑 → 一次提交。这在 UX 层面是正确的方向。

但 PATCH 的事务边界设计有缺陷——它不是真正的原子批量操作,而是"顺序执行的多个独立操作"。这在正常路径下没问题,但在异常路径下会产生不一致状态。另外,时间线合并的排序逻辑有潜在的同秒冲突风险。

---

## 问题 1: 取舍 —— 合并进主区 vs 横向并排

**决策合理。**

横向并排(4 个 section 各占一列)的问题在于:

- **移动端无法适配**:4 列在手机屏幕上完全不可行,合并到主区是响应式布局的正确选择
- **提交粒度**:横向并排往往导致每个 section 单独保存,用户需要点 4 次。合并后一次保存,UX 更流畅
- **语义一致性**:编辑操作本身就是一个"进入编辑模式 → 修改 → 提交"的生命周期,放在主区更符合这个 mental model

唯一需要考虑的权衡是状态复杂度:4 个字段在同一个表单里,React state 管理会比独立 section 更复杂。但这已经在 `TicketDetail.tsx:183-186` 的 useState 声明中清晰表达,风险可控。

**结论:决策正确,无需改变。**

---

## 问题 2: 可观测性 / 可回滚 —— 事务边界缺陷

**事务边界设计有缺陷,需要正视。**

PATCH 的写操作分为这几类:

| 操作 | 是否在事务内 | 代码行 |
|---|---|---|
| priority 更新 | ❌ 独立 `prisma.ticket.update` | 392-403 |
| moduleId 更新 | ❌ 独立 `prisma.ticket.update` | 406-419 |
| status 更新 + statusHistory | ✅ `$transaction` | 423-435 |
| assigneeIds 更新 + history | ✅ `$transaction` | 450-461 |
| title/description 更新 | ❌ 独立 `prisma.ticket.update` | 465-469 |
| ModerationLog | ❌ 每次独立 | 396, 436, 453 |

**异常场景**:用户同时修改了 priority(P0 → P1)和 moduleId(旧模块 → 新模块):

1. priority 先写入 DB ✓
2. moduleId 更新时权限校验失败 → API 返回 403
3. **结果**:priority 已经改成了 P1,但 moduleId 还在旧模块

这是一个部分成功的不一致状态。

**与子路由对比**:子路由每个都是单字段操作,有独立事务。如果这些子路由还在被调用,它们是安全的。但合并后的主 PATCH 应该要么:

- **方案 A**:把所有写操作包进一个 `$transaction`(简单但会引入不必要的锁竞争)
- **方案 B**:保留当前分离式更新,但在客户端(`TicketDetail.tsx:259-293 saveAll`)做预校验,只有预校验全部通过才发送 PATCH

**方案 B 更适合当前场景**——因为权限校验在 PATCH 入口处已经统一做过(`route.ts:316-381`),理论上走到写操作时不应该有权限问题。

**建议方向**:评估"部分写入后失败"的实际发生概率。可以接受当前设计,但建议在 `saveAll` 里增加乐观锁机制(通过 `version` 或 `updatedAt` 字段)来检测并发修改。

---

## 问题 3: 边界 case —— 时间线合并的同秒冲突

**有时间显示精度问题,但实际影响较小。**

排序逻辑在 `TicketDetail.tsx:399`:

```ts
return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
```

**同秒冲突场景**:用户在同一分钟内改了 status、assignee、priority 三个字段。如果 DB 时间戳精度是秒级,三个操作的 `createdAt` 可能完全相同,排序结果取决于 JS 引擎的数组插入顺序。

**实际影响评估**:低频边界 case。在 ProjectHub 的使用场景里,同一用户在同一秒内修改多个字段的概率很低。

**建议方向**:

- 短期:接受现状,监控用户反馈
- 如果需要修复:在 `EnrichedHistoryEntry` 类型里增加 `index` 字段作为二级排序键

---

## 问题 4: 扩展性 —— 新字段如何加入

**PATCHBody 没有预留扩展性,需要一次小重构。**

当前 `route.ts:254-261` 的 `PATCHBody`:

```ts
type PATCHBody = {
  title?: string;
  description?: string;
  status?: TicketStatus;
  assigneeIds?: string[];
  priority?: number;
  moduleId?: string;
};
```

如果后续要加 `severity` 或 `fixVersion`,开发者需要在 4 个地方分散修改(TS 类型、校验规则、写操作、权限判断),没有统一入口。

**建议方向**:引入"字段注册表"模式:

```ts
const TICKET_EDITABLE_FIELDS = {
  title: { writableBy: ['assignee', 'root'], maxLength: 200 },
  status: { writableBy: ['assignee', 'root'] },
  priority: { writableBy: ['assignee', 'root'] },
  severity: { writableBy: ['root'] }, // 新字段从这里加
};
```

这样新字段加入时,只需要在注册表里加一行,后面的校验/更新逻辑自动继承。

**短期建议**:如果 PR9 之后没有明确的新字段计划,可以先不加这套抽象,保持简单。等 `severity` 或 `fixVersion` 真的出现时再做重构。

---

## 问题 5: 教学价值 —— 复用场景

**场景 A: 派单管理(DispatchProjectDetail)**

`features/dispatch/ui/DispatchProjectDetail.tsx` 目前可能有多个独立的状态编辑入口。

复用方式:把 Dispatch 的多个 section 也合并到主区编辑,和 `TicketDetail.tsx` 共享 `EnrichedHistoryEntry` 类型和 `activityLog` 合并逻辑。

复用收益:统一的操作记录 UI 组件和 PATCH 请求结构。

**场景 B: 团队成员权限变更**

`features/team/ui/ProfileAiSummary.tsx` 可能涉及成员的角色变更操作。

复用方式:成员变更也可以走"进入编辑模式 → 修改 → 批量保存 → 统一操作记录"的模式。

---

## 下一步建议

### 必须关注(本次 PR9 需要正视)

| 优先级 | 建议 | 理由 |
|---|---|---|
| 🔴 高 | 评估"部分写入后失败"的实际风险 | priority + moduleId + title 都在事务外,理论上存在不一致状态 |
| 🟡 中 | 监控时间线排序的用户反馈 | 同秒冲突是低频 case |

### 可选优化(未来迭代)

| 优先级 | 建议 | 时机 |
|---|---|---|
| 🟢 低 | 引入 `TICKET_EDITABLE_FIELDS` 字段注册表 | 等 `severity`/`fixVersion` 真的出现时再做 |
| 🟢 低 | 提取 `activityLog` 合并逻辑为独立 hook | 等 `DispatchProjectDetail` 需要时再做 |

### 不需要做

- ❌ 不需要把主 PATCH 改成全字段事务(过度设计,引入锁竞争)
- ❌ 不需要废弃子路由(子路由在单独场景下仍然有价值)

---

*本报告由 ai-learning-mentor 子代理(架构顾问)生成,主代理负责决策后续处理。*
