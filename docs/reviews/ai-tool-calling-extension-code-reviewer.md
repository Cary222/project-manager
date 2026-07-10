<!-- reviewer: code-reviewer (硬层) -->

# Code Review: `searchStructured` AI Tool Extension

**Scope:** `features/ai/tools/search-structured.ts` (new), `features/ai/tools/index.ts` (modified)
**Review Type:** Local Changes

---

## Verdict: ❌ Request Changes

**1 个 Critical (Must Fix) 和 2 个 High 级别问题必须修复后方可合并。**

---

## Critical (Must Fix)

### 1. **`viewerUserId` 完全未用于权限控制**

- **`[search-structured.ts:207]`** `queryTickets` 接收 `viewerUserId` 但从未使用，函数体内零权限校验
- **`[search-structured.ts:212]`** `queryProjects` 同上
- **`[search-structured.ts:215]`** `queryUsers` 同上
- **`[search-structured.ts:219]`** `queryWeeklyReports` 接收 `viewerUserId` 但从未使用
- **`[search-structured.ts:45]`** `queryByFilters` 将 `viewerUserId` 透传给 4 个子函数，但子函数全部忽略

Impact: `viewerUserId` 形同虚设。认证用户可查询/列举任意项目/工单/周报，无任何所有权或成员关系校验。

Suggestion: 在 `queryTickets` / `queryProjects` 中按 `viewerUserId` 过滤：
  - `queryTickets`: 加 `viewerUserId` → 必须同时满足 `assignees.some({ userId: viewerUserId })` 或 `project.members.some({ userId: viewerUserId })`
  - `queryProjects`: 加 `viewerUserId` → 必须满足 `members.some({ userId: viewerUserId })` 或 `ownerId === viewerUserId`
  - `queryWeeklyReports`: 加 `viewerUserId` → 只返回 `userId === viewerUserId` 的周报（或保留白名单逻辑的 TODO 注释）
  - 临时缓解：`viewerUserId` 为空时拒绝列举类查询（过滤查询中 `id` 不存在时才进入），降低信息泄漏面

### 2. **返回类型不一致，上游无法统一处理**

- 精确查询（`id` 存在时）返回 `{ error: string }` 或 `{ content: string; meta: object }`
- 过滤查询（`id` 不存在时）返回 `{ message: string; results: ... }` 或 `{ error: string }`

Impact: 调用方（`AiChatPanel` 或 LLM prompt 解析）无法用统一逻辑判断成功/失败，必须为每种类型写独立判断。

Suggestion: 统一返回格式，建议：

```typescript
type ToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

// 精确查询成功示例
return { success: true, data: formatTicketDetail(ticket) };
// 精确查询失败
return { success: false, error: `工单 #${ticketNo} 不存在` };
// 过滤查询成功
return {
  success: true,
  data: { message: `找到 ${tickets.length} 个工单`, results: tickets.map(formatTicketSummary) }
};
```

---

## High (Recommended — 阻塞性较低但影响正确性)

### 3. **过滤查询 `queryTickets` 遗漏 `module` 和 `creator` 字段，导致类型不匹配**

- **`[search-structured.ts:238-253]`** `queryTickets` 的 Prisma `select` 包含 `module: { select: { name: true } }` 和 `creator: { select: { name: true } }`
- 但 `formatTicketDetail` 的入参类型（被 `formatTicketSummary` 共享时）只用到 `project` 和 `assignees`，不依赖 `module`/`creator`
- **真正问题**：`queryByFilters` 的 `type` 参数是 `string` 而非 `z.infer<typeof inputSchema>["type"]`，switch 非穷举检查失效；新增 enum 值时编译器不报警

Impact: switch 穷举性丢失，新增 type 值（如 `"invoice"`）时 TypeScript 不会报错，运行时走 `default` 分支静默返回错误。

Suggestion:
  - `queryByFilters` 的 `type` 参数改为 `Input["type"]`（或 `z.infer<typeof inputSchema>["type"]`）
  - 加 `default: unreachable(type)` 或在编译时用 `never` 类型守卫

### 4. **`execute` 函数无 try/catch，Prisma 异常将上抛至调用栈**

- **`[search-structured.ts:25-46]`** 整块 `execute` 无 try/catch
- 若 `prisma` 连接断开 / 超时 / schema 不匹配，将抛出未捕获的 `PrismaClientKnownRequestError` 等

Impact: 上层 SSE 流被打断，AI 对话面板收到 500 错误而非友好的 `success: false` 响应。

Suggestion: 在 `execute` 外层包 try/catch，统一返回 `{ success: false; error: string }`：

```typescript
execute: async (params: Input) => {
  try {
    // 现有逻辑...
  } catch (err) {
    console.error("[searchStructured] execute error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "查询失败，请稍后重试",
    };
  }
}
```

---

## Improvements (Recommended)

### 5. **`formatTicketDetail` 的 priority 边界未覆盖**

- **`[search-structured.ts:413]`** `priorityLabel = ["紧急","高","中","低"][ticket.priority - 1]` 当 `ticket.priority` 为 0 或 > 4 时返回 `undefined`，后接 `?? "未知"` 能兜住，但调用方拿到 `"未知"` 时无法判断是数据缺失还是真实值
- Suggestion: 在 `queryTickets` 的 Prisma where 层加 `where: { priority: { gte: 1, lte: 4 } }` 约束（对齐 schema 注释的 1-4 范围），或在 Zod schema 层用 `.refine()` 校验

### 6. **`toLocaleDateString` 存在 locale 依赖风险**

- **`[search-structured.ts:425, 474, 523, 561, 594]`** 多处使用 `toLocaleDateString("zh-CN")`
- 若服务器 locale 非中文，结果格式不可预期（LLM 看到的日期字符串解析可能出错）
- Suggestion: 统一用 `toISOString().split("T")[0]` 格式（已在 `formatWeeklyReport` 的 `meta` 中使用），`content` 显示字符串也保持一致

### 7. **`formatProjectStats` 无 ticket 数据量保护**

- **`[search-structured.ts:79-99]`** `queryProjectById` 用 `include` 深度嵌套加载所有 module → 所有 ticket 的 status/priority/deadline，若项目有数千个 ticket，内存占用显著
- Suggestion: 当前 `responsibilities.modules.tickets` 只 select 3 个字段（已做投影），但仍建议加 `take` 或在 `queryProjectById` 限制 `maxTicketPerModule`；或改用 `$queryRaw` 聚合

### 8. **`queryTickets` 中 status 字符串未经枚举校验**

- **`[search-structured.ts:226]`** `where.status = filters.status as TicketStatus` 为硬类型断言，若 LLM 传了 `"INVALID_STATUS"` 字符串，Prisma 会抛出 `PrismaClientValidationError`
- Suggestion: 先校验 `Object.values(TicketStatus).includes(filters.status as TicketStatus)` 再赋值，或在 Zod schema 层用 `z.enum(Object.values(TicketStatus))` 定义 `status` 字段

---

## Nitpicks (Optional)

- **`[search-structured.ts:19]`** `type Input = z.infer<typeof inputSchema>` — 可直接内联到 `execute: async (params: z.infer<typeof inputSchema>)` 省一次类型别名
- **`[search-structured.ts:265-304]`** `queryProjects` 定义了 `filters: { projectId?: string }` 参数但从未使用（只用 `filters?.projectId` 过滤），`limit` 参数同样未透传给 Prisma `take`（`take: limit ?? 5` 已正确使用），参数命名略冗余但不影响功能

---

## Positive Points

- **Prisma 投影做得好**：所有查询都用 `select` 精确投影字段，未 `include` 整表，符合数据最小化原则
- **并行查询 `queryUserById`**：`Promise.all([tickets, reports])` 并行执行，效率高 ✅
- **commit SHA 前缀匹配**：`startsWith` 支持不完整的 SHA 查询，体验好 ✅
- **工单号 `#` 前缀解析**：`parseInt(id.replace("#", ""), 10)` 正确处理 `#10156` 格式 ✅
- **`limit` 有界**：`z.number().min(1).max(20).default(5)` 在 schema 层限制了最大返回量，防止 DML 放大 ✅
- **`tools/index.ts` 干净**：`StructuredToolSet` 定义正确，`toolsetForMode` 逻辑清晰，无冗余 ✅

---

## Summary

| 维度 | 评级 | 说明 |
|------|------|------|
| Correctness | ⚠️ | 返回类型不一致；`viewerUserId` 形同虚设 |
| Maintainability | ⚠️ | `type` 参数非穷举；函数参数冗余 |
| Efficiency | ✅ | Prisma 投影正确；并行查询；limit 有界 |
| Security | ❌ | 权限控制完全缺失 |
| Edge Cases | ⚠️ | try/catch 缺失；status 未校验；priority 边界 |
| Testing | N/A | 无测试文件（建议补充） |

---

## 必须修复项（按优先级）

1. **[Critical]** 补全 `viewerUserId` 权限过滤逻辑，或在 `id` 缺失时拒绝过滤查询
2. **[Critical]** 统一返回类型为 `{ success: true/false; data/error: ... }`
3. **[High]** `queryByFilters` 的 `type` 参数改为联合类型并启用穷举检查
4. **[High]** `execute` 外层加 try/catch，防止 Prisma 异常上抛

> tsc 报告中的错误（`features/admin/admin.test.ts` / `e2e/module-edit.spec.ts`）均为历史遗留，不属于本次审查范围。
