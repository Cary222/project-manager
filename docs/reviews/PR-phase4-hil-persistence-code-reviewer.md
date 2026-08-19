<!-- reviewer: code-reviewer (硬层) -->

# Phase 4 HIL + Persistence 代码审查（硬层）

## 审查摘要

**总体评价**：Phase 4 P0（API + 事件流 + 翻译）通过 10/10 验证脚本，但 **P1 持久化层（PolicyRule / PolicyAuditLog / SubAgentRun）存在多处阻塞发布的硬层问题**，主要是 schema 与代码不一致、tsc 类型错误无法消除、运行时必然崩溃。

**严重问题数量**：
- P0 阻塞级：**3 项**（schema 字段不匹配导致代码不可用、duplicate identifier 编译错误、内存索引器 hot path 错误）
- P1 重要但不阻塞：**7 项**
- P2 优化建议：**8 项**

---

## P0 - 阻塞发布

### P0-1 ⚠️ **PolicyRule 模型与代码严重不一致 —— 写入/读取路径无法运行**

- **[`prisma/schema.prisma:1069-1087`](prisma/schema.prisma)** vs **[`features/ai/agents/work/policy/tool-policy.ts:148-153`](features/ai/agents/work/policy/tool-policy.ts)** vs **[`app/api/ai/work/policy/route.ts:79-98`](app/api/ai/work/policy/policy/route.ts)**
  - **Impact**: `PolicyRule` schema 实际字段是 `pattern` / `decision` / `priority`，**没有 `targetName`、没有 `riskLevel` 字段**。但代码引用：
    - `tool-policy.ts:148`：`if (rule.ruleType === "TOOL" && rule.targetName)` —— `targetName` 不存在
    - `tool-policy.ts:150`：`mapRiskLevel(rule.riskLevel)` —— `riskLevel` 不存在
    - `route.ts:79,82,89-93`：`ruleType, targetName, riskLevel` 字段接收并写入 —— 写入必然报 Prisma 字段错误
  - **Suggestion**：
    1. **方案 A（推荐）**：schema 端给 `PolicyRule` 加回 `targetName String?` 和 `riskLevel String` 字段；migration 也得补。代码无改动。
    2. **方案 B**：改代码用 `pattern` / `decision` 字段，但失去了 tool 风险等级这种语义。
    3. 同步检查 `PolicyRuleType` 枚举：schema 是 `TOOL_WHITELIST / TOOL_BLACKLIST / TOOL_HIL / COMMAND_WHITELIST / COMMAND_BLACKLIST / PATH_BLACKLIST`，但 `tool-policy.ts:148` 比对的是 `"TOOL"`（不在枚举里）。前后端字符串不匹配 → DB 里永远 load 不出任何 rule。
- **验证**：`npx tsx scripts/phase-4-full-verify.ts` 10/10 通过 —— 因为它**只检查字符串是否出现**，不检查 schema 与代码的一致性。**实际运行时会崩溃。**

### P0-2 ⚠️ **`features/ai/agents/work/subagents/pi/transports/sdk.ts:14,26` — Duplicate identifier `prisma`**

- **[`features/ai/agents/work/subagents/pi/transports/sdk.ts:14`](features/ai/agents/work/subagents/pi/transports/sdk.ts)** & **[`:26`](features/ai/agents/work/subagents/pi/transports/sdk.ts)**
  - **Impact**: 同一文件 `import { prisma } from "@/lib/prisma"` 被写了两次，tsc 直接报 `TS2300: Duplicate identifier 'prisma'`，整个 sdk.ts 文件无法通过 type-check。这是 Next.js build 的硬阻塞。
  - **Suggestion**: 删除 `26` 行的重复 import。

### P0-3 ⚠️ **`features/ai/agents/work/policy/index.ts:176` — `Parameter 'log' implicitly has an 'any' type`**

- **[`features/ai/agents/work/policy/index.ts:176`](features/ai/agents/work/policy/index.ts)**
  - **Impact**: `.map(log => ...)` 中 `log` 未显式标注类型；由于 `prisma.policyAuditLog.findMany` 返回的字段（`approvedAt` 等）可能与映射目标 `PolicyAuditEntry` 不一致，**TypeScript strict 模式下视为 any**，失去类型安全。
  - **Suggestion**: 显式标注 `logs.map((log: typeof logs[number]) => ...)` 或定义中间类型。

---

## P1 - 重要但不阻塞

### P1-1 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:419-438` — HIL Promise 状态机有 race condition**

- **Impact**: `createMockPiEventStream` 中先 `pausedRuns.set(runId, { resolve, reject })`，**然后**又 `pausedRuns.set(runId, { resolve: wrappedResolve, reject })` 覆盖了原始的 resolve。这两段代码意图是给 promise 加超时清理，但**实际行为是第二次 set 完全替换第一次**，超时定时器（`setTimeout`）和原始 `resolve` 都挂在第一次的闭包上，第二次的 `wrappedResolve` 中调用的 `originalResolve` 才有 `clearTimeout(timeout)`。
  - **Race**: 如果 `followUp()` 在两次 `set` 之间被调用，会拿到第一次的 `resolve`（没有清理超时），超时定时器最终仍会触发 → reject 已经 resolve 的 promise（虽然 promise resolve 后再 reject 是 no-op，但可能影响 isrejected 判断）。
  - **Suggestion**: 抽出一个 `createPausedRun(runId)` 函数返回 `{ promise, resolve }`，避免重复 set 和闭包混乱。

### P1-2 🚨 **`features/ai/agents/work/policy/index.ts:223-237` — `updateApproval` 缺乏 ownership 检查**

- **Impact**: 用户 A 审批了用户 B 的 run 的 tool_call —— `updateApproval` 直接把 `approvedBy` 写成调用者，没有校验 `runId` 对应的 `SubAgentRun.userId` 是否等于当前用户。
  - **Suggestion**: 加 `await prisma.subAgentRun.findFirst({ where: { runId } })`，确认当前用户是该 run 的 owner（或 ROOT）才允许 update。或者改为「run owner + ROOT 可审批」语义。
- **关联**：与 approve route 配合，approve route 也没有 ownership 校验 → cross-mentor 取舍问题，但**「应该 check ownership」是硬技术层**。

### P1-3 🚨 **`app/api/ai/work/approve/route.ts:188-207` — GET endpoint 逻辑反人类**

- **Impact**: `getAuditLog({ decision: "approve" })` 然后 `entry.timestamp.includes("approved")` 判断是否已审批 —— **`timestamp` 是 ISO 字符串，包含"approved" 这个串的概率取决于 ISO 拼接位置**（实际 ISO 是 `2025-08-19T10:42:00.000Z`，不含 "approved"）。即 **永远过滤不掉任何条目**。
  - **Suggestion**: 用真实字段判断：
    ```ts
    const pendingApprovals = (await prisma.policyAuditLog.findMany({
      where: { runId, decision: "APPROVE", approvedAt: null }
    }));
    ```
    直接用 SQL 过滤，不要在内存里字符串匹配。
- **顺带**：`callId: entry.tool || "unknown"` 用 `tool` 字段当 `callId` —— 字段错位，数据语义错误。

### P1-4 🚨 **`features/ai/agents/work/policy/tool-policy.ts:107-129` — `targetName` / `riskLevel` 字段实际不存在**

- 同 P0-1：tool-policy.ts 的 `loadPoliciesFromDB` 用 `rule.targetName` 和 `rule.riskLevel`，schema 上无此字段。
- **Suggestion**: 同 P0-1 解决方案 A/B 二选一。

### P1-5 ⚡ **`features/ai/agents/work/subagents/pi/transports/sdk.ts:419-427` — 超时定时器永远不会被清理（除非 followUp）**

- **Impact**: `setTimeout(() => { ... reject(...) }, 5*60*1000)` 这个定时器**只在 `wrappedResolve` 被调用时清理**。如果 HIL 走 `cancel` 路径（用户拒绝），resolve 不会被调用 → 定时器仍在 event loop 注册 → 5 分钟后定时器触发 `reject`，但 promise 已经在 cancel 流程中处理过，reject 是 no-op。但 5 分钟内 node.js event loop 多了一个定时器引用。
  - **Suggestion**: cancel 时同步清理 `clearTimeout(timeout)`。

### P1-6 ⚡ **`features/ai/agents/work/policy/index.ts:108-130` — 审计日志内存缓存和 DB 异步写入存在一致性漏洞**

- **Impact**: `recordAudit` 先同步写内存、再 `void` 异步写 DB。如果 DB 写入失败，内存里有记录但 DB 里没有 → `getAuditLog` 主路径走 DB，**内存降级路径只在 catch 才生效**（即 `prisma.findMany` 本身成功时永远不返回内存数据）。两次访问的真相源不一致。
  - **Suggestion**: 明确降级触发条件（比如 DB 抛特定错才用内存），或在每次访问时同时尝试同步 DB 和内存取并集。

### P1-7 ⚡ **`features/ai/agents/work/policy/index.ts:159-191` — `getAuditLog` 无分页参数保护**

- **Impact**: `take: filter?.limit ?? 100` 默认 100，但 `findMany` 一次性拉 `userId`/`tool` 索引命中的所有记录（默认 Postgres 单表扫描 1000 条）。如果某个用户跑过 10000 次 tool_call，**一次查询会带 100 条 + 1000 行扫描**，在 hot path 上慢。
  - **Suggestion**: 加 `offset` / cursor 分页，或用聚合查询（`groupBy`）。

---

## P2 - 优化建议

### P2-1 🔹 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:62-80` — SubAgentRun.create 用 catch 兜底，可能泄漏孤儿 run**

- **Impact**: `start()` 中 `prisma.subAgentRun.create` 失败时只 `console.error` 然后继续执行 → handle 创建出来但 DB 里没记录 → `awaitCompletion` / `abort` 的 DB update 会因为 `where: { id: runId }` 找不到而抛错（被 try-catch 吞了）→ 状态最终留在内存里，与 DB 永久不一致。
  - **Suggestion**: 区分「非致命错误」（context 注入失败，run 仍能跑）和「致命错误」（DB 写入失败，应当抛错拒绝启动）。

### P2-2 🔹 **`features/ai/agents/work/policy/tool-policy.ts:132-202` — 缓存的并发不安全**

- **Impact**: 多个并发 `checkTool` 调用同时发现 `cachedPolicies === null`，会**全部并发调用 `loadPoliciesFromDB`**（cache stampede）。QPS 高时 DB 抖动。
  - **Suggestion**: 用 `Promise` 单飞（in-flight promise 缓存）或简单的 mutex。

### P2-3 🔹 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:417-438` — PausedRun Map 内存管理缺策略**

- **Impact**: 没有 LRU、没有 size 上限、没有清理 rejected 的 resolver → 异常 cancel 路径下 `pausedRuns` 可能泄漏（小概率，但累积）。
  - **Suggestion**: 加 `setMaxSize` + 周期性 sweep。

### P2-4 🔹 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:419` — `userId: input.userId || "system"` 用 "system" 字符串占位**

- **Impact**: DB 外键约束 `userId → User(id)`，如果传 undefined 会写空字符串；但代码用 `"system"`，要求 DB 里必须存在一个 `id = "system"` 的用户。**这是个隐式约束**，schema 没说明，迁移没 seed。
  - **Suggestion**: 显式抛出 `InputValidationError` 而不是用魔法字符串兜底；或在 schema 注释中明确。

### P2-5 🔹 **`features/ai/agents/work/subagents/pi/events.ts:169-254` — `translateSingleEvent` 大量 `as string` 断言，类型不安全**

- **Impact**: `piEvent.content as string`、`piEvent.tool as string` 等每次都断言。PiEvent 是 `{ type: string; [key: string]: unknown }`，应通过 `piEvent['content']` + type guard。
  - **Suggestion**: 用 discriminated union 重构 `PiEvent`，每个 case 严格 narrow 后访问字段。

### P2-6 🔹 **`features/ai/agents/work/policy/index.ts:262-271` — `PolicyAuditEntry` 缺 `args` 字段**

- **Impact**: DB 里有 `args JSONB`，但 `PolicyAuditEntry` interface 没暴露 → `getAuditLog` 返回后丢失原始 args，调试无法还原。
  - **Suggestion**: 加 `args?: Record<string, unknown>` 字段。

### P2-7 🔹 **`features/ai/agents/work/policy/command-policy.ts:142-159` — `Array.from(DENY_COMMANDS)` 每次遍历都重建数组**

- **Impact**: 微优化，但 for...of 直接遍历 Set 也可读。`Array.from` 在 hot path 上无意义。
  - **Suggestion**: 直接 `for (const denied of DENY_COMMANDS)`，去掉 `Array.from`。

### P2-8 🔹 **`features/ai/agents/work/policy/tool-policy.ts:251-259` — path check 只在 `risk === medium/high` 时跑**

- **Impact**: `policy.risk === "dangerous"` 的 shell 工具不跑 path check（被 command-policy 接管），但 `policy.risk === "high"` 的 fetch/http_request 也不跑 path check —— 正确。但 `risk === "medium"` 文件工具一定有 path check 假设，**没考虑 default policy 是 `"medium"` 的情况**（mapRiskLevel fallback）。`ruleRiskLevel = undefined` 也会 fallback `"medium"`，然后跑 path check —— 如果 args 里没 `path`/`file`，`paths.length === 0`，path-policy 返回 `allow`。
  - **Suggestion**: 这个行为合理，但建议加注释说明 fallback 语义。

---

## ✅ 亮点

1. **结构清晰**：`policy/{index,tool-policy,command-policy,path-policy}.ts` 四个文件职责单一，FSD 边界正确。`subagents/pi/{runtime,sdk,events,context,subagent}.ts` 同样的分层做得不错。

2. **HIL Promise 超时机制有兜底**：5 分钟超时硬限制防止内存泄漏（虽然在 P1-5 提到的 cleanup 路径有 bug，但有这个机制就是好的）。

3. **Policy API ROOT 权限校验完整**：`app/api/ai/work/policy/route.ts` 每个 handler 都检查 `role === "ROOT"`，符合项目权限约定。

4. **审计日志 DB schema 设计完整**：`PolicyAuditLog` 的索引覆盖 `userId+createdAt / runId / tool+createdAt / decision+createdAt` 四个查询场景，索引策略合理。

5. **数据库迁移脚本结构清晰**：`migration.sql` 用 `pm.` schema 命名空间隔离业务表（符合 AGENTS.md § 关键约束），FK 都带 `onDelete` 行为。

6. **`path-policy.ts` 用 `path.relative()` 而非 `startsWith()`**：路径越界判断是正确的，避免 `startsWith` 在 `/workspace-evil` 这种前缀攻击下失守。

7. **错误处理模式统一**：所有 API 路由都 `try/catch` + 返回 5xx + console.error，模式一致。

8. **`clearPolicyCache()` 在 CRUD 后调用**：POST/PUT/DELETE 后立即清缓存，避免脏读。

---

## 审查结论

- **状态**: ❌ **CHANGES_REQUIRED**
- **理由**: P0-1（schema 字段不匹配）单独就足以让 PolicyRule 写入/读取全路径在运行时崩溃，加上 P0-2（duplicate identifier）和 P0-3（隐式 any），**整个 build 无法通过**。即使忽略 P0，approve API 的 GET endpoint（P1-3）返回的 `pendingApprovals` 永远包含已审批的条目（字符串 includes 判断永远为 false），属于静默 bug。**P0-1 + P0-2 必须修复后才能合并**。

---

## 修复顺序建议（给 fullstack-developer）

1. **P0-2**（5 行）：删 `sdk.ts:26` 的重复 import → 解除 build 阻塞。
2. **P0-3**（3 行）：给 `policy/index.ts:176` 的 `log` 加显式类型。
3. **P0-1**（关键决策）：Main 与 schema 负责人确认 schema 字段（`targetName` / `riskLevel` / ruleType 字符串 `"TOOL"`）是否需要加回，还是改代码用 `pattern` + `decision`。
4. **P1-3**（5 行）：approve GET 改为 Prisma filter `approvedAt: null`，去掉字符串 includes。
5. **P1-1** + **P1-5**（15 行）：合并 HIL Promise resolver 与 timeout 清理逻辑到一个函数。
6. **P1-2**（10 行）：approve 路径加 ownership 检查。
7. **P2** 系列可后续优化。